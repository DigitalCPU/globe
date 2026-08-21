import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path


USERNAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$")
PBKDF2_ITERATIONS = 210_000


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def b64e(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64d(text):
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + padding).encode("ascii"))


def normalize_username(username):
    value = str(username or "").strip()
    if not USERNAME_RE.match(value):
        raise ValueError("Username must be 3-32 characters: letters, numbers, underscore, or dash.")
    return value


def safe_storage_name(username):
    return normalize_username(username).lower()


def hash_password(password):
    text = str(password or "")
    if len(text) < 1:
        raise ValueError("Password is required.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", text.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64e(salt)}${b64e(digest)}"


def verify_password(password, password_hash):
    try:
        scheme, rounds, salt, digest = str(password_hash or "").split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        check = hashlib.pbkdf2_hmac(
            "sha256",
            str(password or "").encode("utf-8"),
            b64d(salt),
            int(rounds),
        )
        return hmac.compare_digest(b64e(check), digest)
    except Exception:
        return False


class AccountStore:
    def __init__(self, db_path, storage_root, secret_path):
        self.db_path = Path(db_path)
        self.storage_root = Path(storage_root)
        self.secret_path = Path(secret_path)

    @classmethod
    def from_config(cls, config):
        return cls(
            db_path=config.account_db_path,
            storage_root=config.user_cloud_root,
            secret_path=config.account_password_secret_path,
        )

    def initialize(self):
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.secret_path.parent.mkdir(parents=True, exist_ok=True)
        self._secret()
        with self.connect() as db:
            db.executescript(
                """
                PRAGMA journal_mode = WAL;

                CREATE TABLE IF NOT EXISTS accounts (
                    account_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    password_ciphertext TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    status TEXT NOT NULL DEFAULT 'active',
                    storage_dir TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    profile_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login TEXT
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS files (
                    file_id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    folder TEXT NOT NULL DEFAULT 'uploads',
                    original_name TEXT NOT NULL,
                    stored_name TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    size INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    scan_status TEXT NOT NULL DEFAULT 'NOT_SCANNED',
                    scan_date TEXT,
                    risk_level TEXT,
                    detected_type TEXT,
                    threat_name TEXT,
                    scanner_notes TEXT,
                    quarantine_status TEXT,
                    FOREIGN KEY(account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
                CREATE INDEX IF NOT EXISTS idx_files_account_id ON files(account_id);
                CREATE INDEX IF NOT EXISTS idx_files_folder ON files(account_id, folder);
                """
            )

    def connect(self):
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        return db

    def _secret(self):
        if self.secret_path.exists():
            text = self.secret_path.read_text(encoding="utf-8").strip()
            try:
                secret = b64d(text)
                if len(secret) >= 32:
                    return secret
            except Exception:
                pass
        secret = secrets.token_bytes(32)
        self.secret_path.write_text(b64e(secret), encoding="utf-8")
        return secret

    def _keystream(self, nonce, length):
        secret = self._secret()
        output = bytearray()
        counter = 0
        while len(output) < length:
            output.extend(hmac.new(secret, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest())
            counter += 1
        return bytes(output[:length])

    def encrypt_password(self, password):
        plaintext = str(password or "").encode("utf-8")
        nonce = secrets.token_bytes(16)
        stream = self._keystream(nonce, len(plaintext))
        cipher = bytes(left ^ right for left, right in zip(plaintext, stream))
        tag = hmac.new(self._secret(), nonce + cipher, hashlib.sha256).digest()
        return f"v1${b64e(nonce)}${b64e(cipher)}${b64e(tag)}"

    def decrypt_password(self, blob):
        version, nonce_text, cipher_text, tag_text = str(blob or "").split("$", 3)
        if version != "v1":
            raise ValueError("Unsupported password encryption version.")
        nonce = b64d(nonce_text)
        cipher = b64d(cipher_text)
        tag = b64d(tag_text)
        expected = hmac.new(self._secret(), nonce + cipher, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("Password ciphertext failed integrity check.")
        stream = self._keystream(nonce, len(cipher))
        plaintext = bytes(left ^ right for left, right in zip(cipher, stream))
        return plaintext.decode("utf-8")

    def account_storage_dir(self, username):
        return self.storage_root / safe_storage_name(username)

    def ensure_account_dirs(self, username):
        root = self.account_storage_dir(username)
        for child in ("uploads", "chats", "profile"):
            (root / child).mkdir(parents=True, exist_ok=True)
        profile_path = root / "profile.json"
        if not profile_path.exists():
            profile_path.write_text("{}\n", encoding="utf-8")
        return root

    def create_account(self, username, password, role="user", status="active", profile=None):
        username = normalize_username(username)
        now = utc_now()
        account_id = f"acct_{secrets.token_urlsafe(18)}"
        storage_dir = self.ensure_account_dirs(username)
        profile_json = json.dumps(profile or {}, separators=(",", ":"))
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO accounts (
                    account_id, username, password_hash, password_ciphertext, role, status,
                    storage_dir, profile_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id,
                    username,
                    hash_password(password),
                    self.encrypt_password(password),
                    role,
                    status,
                    str(storage_dir),
                    profile_json,
                    now,
                    now,
                ),
            )
        return self.get_account(account_id=account_id)

    def get_account(self, account_id=None, username=None):
        if not account_id and not username:
            raise ValueError("account_id or username is required.")
        query = "SELECT * FROM accounts WHERE account_id = ?" if account_id else "SELECT * FROM accounts WHERE username = ? COLLATE NOCASE"
        value = account_id or username
        with self.connect() as db:
            row = db.execute(query, (value,)).fetchone()
        return dict(row) if row else None

    def list_accounts(self):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM accounts ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]

    def authenticate(self, username, password):
        account = self.get_account(username=username)
        if not account or account.get("status") != "active":
            return None
        if not verify_password(password, account.get("password_hash")):
            return None
        now = utc_now()
        with self.connect() as db:
            db.execute("UPDATE accounts SET last_login = ?, updated_at = ? WHERE account_id = ?", (now, now, account["account_id"]))
        account["last_login"] = now
        return account

    def storage_usage(self, account):
        root = Path(account["storage_dir"])
        total = 0
        if root.exists():
            for path in root.rglob("*"):
                if path.is_file():
                    try:
                        total += path.stat().st_size
                    except OSError:
                        pass
        return total
