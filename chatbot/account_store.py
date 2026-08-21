import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import time
from pathlib import Path


USERNAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$")
PBKDF2_ITERATIONS = 210_000
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14


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


def safe_file_name(name):
    value = Path(str(name or "upload.bin")).name.strip().replace("\x00", "")
    value = re.sub(r"[^A-Za-z0-9._ -]+", "_", value).strip(" .")
    return value[:160] or "upload.bin"


def safe_folder_name(name):
    parts = []
    for part in str(name or "uploads").replace("\\", "/").split("/"):
        clean = re.sub(r"[^A-Za-z0-9._ -]+", "_", part).strip(" .")
        if clean and clean not in (".", ".."):
            parts.append(clean[:80])
    return "/".join(parts) or "uploads"


def hash_password(password):
    text = str(password or "")
    if len(text) < 1:
        raise ValueError("Password is required.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", text.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64e(salt)}${b64e(digest)}"


def hash_session_token(token):
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


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
        try:
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
        except sqlite3.IntegrityError as exc:
            raise ValueError("Username is already taken.") from exc
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

    def set_password(self, account, password):
        if not account:
            raise ValueError("Account is required.")
        now = utc_now()
        with self.connect() as db:
            db.execute(
                """
                UPDATE accounts
                SET password_hash = ?, password_ciphertext = ?, updated_at = ?
                WHERE account_id = ?
                """,
                (hash_password(password), self.encrypt_password(password), now, account["account_id"]),
            )
        return self.get_account(account_id=account["account_id"])

    def set_role(self, account, role):
        if not account:
            raise ValueError("Account is required.")
        clean_role = str(role or "user").strip()[:40] or "user"
        now = utc_now()
        with self.connect() as db:
            db.execute(
                "UPDATE accounts SET role = ?, updated_at = ? WHERE account_id = ?",
                (clean_role, now, account["account_id"]),
            )
        return self.get_account(account_id=account["account_id"])

    def set_status(self, account, status):
        if not account:
            raise ValueError("Account is required.")
        clean_status = str(status or "active").strip().lower()
        if clean_status not in {"active", "disabled"}:
            raise ValueError("status must be active or disabled.")
        now = utc_now()
        with self.connect() as db:
            db.execute(
                "UPDATE accounts SET status = ?, updated_at = ? WHERE account_id = ?",
                (clean_status, now, account["account_id"]),
            )
            if clean_status != "active":
                db.execute("DELETE FROM sessions WHERE account_id = ?", (account["account_id"],))
        return self.get_account(account_id=account["account_id"])

    def set_username(self, account, username):
        if not account:
            raise ValueError("Account is required.")
        username = normalize_username(username)
        existing = self.get_account(username=username)
        if existing and existing["account_id"] != account["account_id"]:
            raise ValueError("Username is already taken.")
        old_root = Path(account["storage_dir"])
        new_root = self.account_storage_dir(username)
        if old_root.resolve() != new_root.resolve():
            if new_root.exists():
                raise ValueError(f"Storage folder already exists: {new_root}")
            if old_root.exists():
                new_root.parent.mkdir(parents=True, exist_ok=True)
                old_root.rename(new_root)
            else:
                self.ensure_account_dirs(username)
        now = utc_now()
        try:
            with self.connect() as db:
                db.execute(
                    """
                    UPDATE accounts
                    SET username = ?, storage_dir = ?, updated_at = ?
                    WHERE account_id = ?
                    """,
                    (username, str(new_root), now, account["account_id"]),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Username is already taken.") from exc
        return self.get_account(account_id=account["account_id"])

    def delete_account(self, account, delete_files=False):
        if not account:
            raise ValueError("Account is required.")
        storage_dir = Path(account["storage_dir"])
        with self.connect() as db:
            db.execute("DELETE FROM accounts WHERE account_id = ?", (account["account_id"],))
        if delete_files and storage_dir.exists():
            root = self.storage_root.resolve()
            target = storage_dir.resolve()
            if root == target or root not in target.parents:
                raise ValueError("Refusing to delete outside user_cloud storage.")
            shutil.rmtree(target)
        return {"account_id": account["account_id"], "username": account["username"], "storage_dir": str(storage_dir)}

    def create_session(self, account_id, user_agent="", ip="", ttl_seconds=SESSION_TTL_SECONDS):
        if not account_id:
            raise ValueError("account_id is required.")
        token = f"sess_{secrets.token_urlsafe(32)}"
        now = utc_now()
        expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + int(ttl_seconds)))
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen, user_agent, ip)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    hash_session_token(token),
                    account_id,
                    now,
                    expires_at,
                    now,
                    str(user_agent or "")[:500],
                    str(ip or "")[:120],
                ),
            )
        return token

    def session_account(self, token):
        if not token:
            return None
        now = utc_now()
        token_hash = hash_session_token(token)
        with self.connect() as db:
            row = db.execute(
                """
                SELECT accounts.*
                FROM sessions
                JOIN accounts ON accounts.account_id = sessions.account_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            if row:
                db.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, token_hash))
        account = dict(row) if row else None
        if not account or account.get("status") != "active":
            return None
        return account

    def delete_session(self, token):
        if not token:
            return 0
        with self.connect() as db:
            cursor = db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))
        return cursor.rowcount

    def delete_expired_sessions(self):
        with self.connect() as db:
            cursor = db.execute("DELETE FROM sessions WHERE expires_at <= ?", (utc_now(),))
        return cursor.rowcount

    def public_account(self, account, include_storage=False):
        if not account:
            return None
        try:
            profile = json.loads(account.get("profile_json") or "{}")
        except Exception:
            profile = {}
        payload = {
            "account_id": account.get("account_id"),
            "username": account.get("username"),
            "display_name": account.get("display_name") or profile.get("display_name") or account.get("username"),
            "role": account.get("role"),
            "status": account.get("status"),
            "profile": profile,
            "created_at": account.get("created_at"),
            "updated_at": account.get("updated_at"),
            "last_login": account.get("last_login"),
        }
        if include_storage:
            payload["storage_dir"] = account.get("storage_dir")
            payload["storage_usage_bytes"] = self.storage_usage(account)
        return payload

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

    def account_file_path(self, account, folder, filename):
        root = Path(account["storage_dir"]).resolve()
        folder_name = safe_folder_name(folder)
        file_name = safe_file_name(filename)
        target_dir = (root / folder_name).resolve()
        target_path = (target_dir / file_name).resolve()
        if root != target_path and root not in target_path.parents:
            raise ValueError("File path is outside account storage.")
        return root, folder_name, file_name, target_dir, target_path

    def unique_file_path(self, account, folder, filename):
        root, folder_name, file_name, target_dir, target_path = self.account_file_path(account, folder, filename)
        stem = Path(file_name).stem or "upload"
        suffix = Path(file_name).suffix
        counter = 1
        while target_path.exists():
            file_name = safe_file_name(f"{stem}-{counter}{suffix}")
            target_path = (target_dir / file_name).resolve()
            if root != target_path and root not in target_path.parents:
                raise ValueError("File path is outside account storage.")
            counter += 1
        return root, folder_name, file_name, target_dir, target_path

    def register_file(self, account, folder, original_name, stored_name, content_type, size):
        now = utc_now()
        file_id = f"file_{secrets.token_urlsafe(18)}"
        relative_path = f"{safe_folder_name(folder)}/{safe_file_name(stored_name)}"
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO files (
                    file_id, account_id, folder, original_name, stored_name, relative_path,
                    content_type, size, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file_id,
                    account["account_id"],
                    safe_folder_name(folder),
                    safe_file_name(original_name),
                    safe_file_name(stored_name),
                    relative_path,
                    str(content_type or "application/octet-stream")[:160],
                    int(size),
                    now,
                    now,
                ),
            )
        return self.get_file(account, file_id=file_id)

    def list_files(self, account, folder=None):
        params = [account["account_id"]]
        query = "SELECT * FROM files WHERE account_id = ?"
        if folder:
            query += " AND folder = ?"
            params.append(safe_folder_name(folder))
        query += " ORDER BY created_at DESC"
        with self.connect() as db:
            rows = db.execute(query, params).fetchall()
        return [self.public_file(dict(row)) for row in rows]

    def get_file(self, account, file_id=None, relative_path=None):
        if not file_id and not relative_path:
            raise ValueError("file_id or relative_path is required.")
        if file_id:
            query = "SELECT * FROM files WHERE account_id = ? AND file_id = ?"
            params = (account["account_id"], file_id)
        else:
            query = "SELECT * FROM files WHERE account_id = ? AND relative_path = ?"
            params = (account["account_id"], str(relative_path or ""))
        with self.connect() as db:
            row = db.execute(query, params).fetchone()
        return dict(row) if row else None

    def delete_file_record(self, account, file_id=None, relative_path=None):
        file_row = self.get_file(account, file_id=file_id, relative_path=relative_path)
        if not file_row:
            return None
        with self.connect() as db:
            db.execute("DELETE FROM files WHERE account_id = ? AND file_id = ?", (account["account_id"], file_row["file_id"]))
        return file_row

    def public_file(self, file_row):
        return {
            "file_id": file_row.get("file_id"),
            "folder": file_row.get("folder"),
            "name": file_row.get("original_name"),
            "stored_name": file_row.get("stored_name"),
            "path": file_row.get("relative_path"),
            "content_type": file_row.get("content_type"),
            "size": file_row.get("size"),
            "created_at": file_row.get("created_at"),
            "updated_at": file_row.get("updated_at"),
            "scan_status": file_row.get("scan_status"),
        }
