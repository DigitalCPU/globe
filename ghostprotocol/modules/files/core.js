(function (GP) {
  const Files = GP.Files = GP.Files || {};
  async function uploadFile(file, folder = 'ghost') {
    const started = await GP.api('/api/id/files/upload/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name || 'ghost-upload.bin',
        folder,
        content_type: file.type || 'application/octet-stream',
        size: file.size
      })
    });
    const uploadId = started.upload_id;
    const chunkSize = Number(started.chunk_size || (8 * 1024 * 1024));
    let offset = Number(started.received || 0);
    try {
      while (offset < file.size) {
        const next = Math.min(offset + chunkSize, file.size);
        const chunk = file.slice(offset, next);
        const result = await GP.api(`/api/id/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
        offset = Number(result.received || next);
        GP.write(`upload ${Math.floor((offset / file.size) * 100)}%`);
      }
      return GP.api('/api/id/files/upload/finish', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      });
    } catch (error) {
      await GP.api('/api/id/files/upload/cancel', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      }).catch(() => {});
      throw error;
    }
  }

  function chooseFile(inputElement) {
    return new Promise((resolve) => {
      inputElement.value = '';
      inputElement.onchange = () => resolve(inputElement.files && inputElement.files[0]);
      inputElement.click();
    });
  }

  async function upload() {
    if (!GP.requireAccount()) return;
    const file = await chooseFile(GP.dom.fileInput);
    if (!file) {
      GP.write('upload canceled');
      return;
    }
    try {
      GP.write(`uploading ${file.name}...`);
      const result = await uploadFile(file);
      GP.write(`stored ${result.file.name || result.file.stored_name} (${GP.formatBytes(result.file.size)})`);
    } catch (error) {
      GP.write(error.message || 'upload failed', 'error');
    }
  }

  async function camera() {
    if (!GP.requireAccount()) return;
    const file = await chooseFile(GP.dom.cameraInput);
    if (!file) {
      GP.write('camera canceled');
      return;
    }
    try {
      GP.write('sending camera image...');
      const result = await uploadFile(file, 'camera');
      GP.write(`stored ${result.file.name || result.file.stored_name} (${GP.formatBytes(result.file.size)})`);
    } catch (error) {
      GP.write(error.message || 'camera failed', 'error');
    }
  }

  async function downloadFile(file) {
    const response = await fetch(`${GP.API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name || file.stored_name || 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function isImageFile(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = String(file.name || file.stored_name || '').toLowerCase();
    return type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|webp)$/.test(name);
  }

  function fileName(file) {
    return file.name || file.stored_name || 'file';
  }

  function fileType(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = fileName(file).toLowerCase();
    if (isImageFile(file)) return 'images';
    if (type.startsWith('audio/') || /\.(aac|aiff?|flac|m4a|mid|midi|mp3|ogg|opus|wav|weba)$/.test(name)) return 'audio';
    if (type.startsWith('video/') || /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(name)) return 'video';
    return 'documents';
  }

  function isTextDocument(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = fileName(file).toLowerCase();
    return type.startsWith('text/') || /\.(css|csv|html?|js|json|log|md|py|txt|xml|yaml|yml)$/.test(name);
  }

  function isDb3Document(file) {
    return /\.(db|db3|sqlite|sqlite3)$/.test(fileName(file).toLowerCase());
  }

  function categorizedFiles(files) {
    return {
      images: files.filter((file) => fileType(file) === 'images'),
      audio: files.filter((file) => fileType(file) === 'audio'),
      video: files.filter((file) => fileType(file) === 'video'),
      documents: files.filter((file) => fileType(file) === 'documents')
    };
  }

  function fileMeta(file) {
    return `${fileName(file)} / ${GP.formatBytes(file.size)} / ${file.folder || 'root'}`;
  }

  function actionButton(label, handler) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  Files.upload = upload;
  Files.uploadFile = uploadFile;
  Files.chooseFile = chooseFile;
  Files.downloadFile = downloadFile;
  Files.isImageFile = isImageFile;
  Files.fileName = fileName;
  Files.fileType = fileType;
  Files.isTextDocument = isTextDocument;
  Files.isDb3Document = isDb3Document;
  Files.categorizedFiles = categorizedFiles;
  Files.fileMeta = fileMeta;
  Files.actionButton = actionButton;

  GP.upload = upload;
  GP.uploadFile = uploadFile;
  GP.chooseFile = chooseFile;
  GP.fileName = fileName;
  GP.fileMeta = fileMeta;
  GP.isImageFile = isImageFile;
  GP.isTextDocument = isTextDocument;
  GP.camera = camera;
})(window.GhostProtocol);

