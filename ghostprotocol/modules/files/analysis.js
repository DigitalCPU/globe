(function (GP) {
  const Files = GP.Files = GP.Files || {};
  async function inspectDb3File(file, row) {
    if (!Files.isDb3Document(file)) {
      GP.write('database preview is available for .db, .db3, .sqlite, and .sqlite3 files only.', 'error');
      return;
    }
    const existing = row.querySelector('.document-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const data = await GP.api(`/api/id/file/db3?file_id=${encodeURIComponent(file.file_id)}`);
      const preview = document.createElement('pre');
      preview.className = 'document-preview';
      preview.textContent = data.preview || 'No database preview available.';
      row.appendChild(preview);
      GP.autoScroll();
    } catch (error) {
      GP.write(error.message || 'database inspect failed', 'error');
    }
  }

  async function askAiAboutFile(file, row) {
    let reviewing = null;
    try {
      const question = await GP.promptLine(`ask AI about ${Files.fileName(file)}:`);
      reviewing = GP.animatedStatusLine ? GP.animatedStatusLine(Files.isImageFile(file) ? 'reviewing image' : 'AI thinking') : null;
      const data = await GP.api('/api/id/file/explain', {
        method: 'POST',
        body: JSON.stringify({
          file_id: file.file_id,
          question: question.trim() || 'Tell me what this file is.'
        })
      });
      if (reviewing) reviewing.remove();
      const reply = String(data.reply || '').trim();
      if (!reply) throw new Error('empty AI reply');
      if (GP.writeAiReply) GP.writeAiReply(reply);
      else GP.write(`ai> ${reply}`);
      if (GP.state.chatMessages) {
        GP.state.chatMessages.push({ role: 'user', content: `[MyDatabase file: ${Files.fileName(file)}] ${question.trim() || 'Tell me what this file is.'}` });
        GP.state.chatMessages.push({ role: 'assistant', content: reply });
      }
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      GP.write(error.message || 'file interpretation failed', 'error');
    }
  }

  function formatVisionAnalysis(data) {
    const analysis = data.analysis || {};
    const lines = ['AI image notes'];
    if (data.analyzer) {
      lines.push(`local only: ${data.analyzer.local_only ? 'yes' : 'no'}`);
      lines.push(`model: ${data.analyzer.model || 'local-qwen-vl'}`);
    }
    if (data.analyzed_at) lines.push(`analyzed: ${data.analyzed_at}`);
    lines.push('');
    lines.push(`caption: ${analysis.caption || 'no caption available'}`);
    if (Array.isArray(analysis.visible_text) && analysis.visible_text.length) {
      lines.push(`visible text: ${analysis.visible_text.join(' | ')}`);
    }
    if (Array.isArray(analysis.objects) && analysis.objects.length) {
      lines.push(`objects: ${analysis.objects.map((item) => (
        typeof item === 'string' ? item : (item.label || JSON.stringify(item))
      )).join(', ')}`);
    }
    if (analysis.people_count !== undefined && analysis.people_count !== null) {
      lines.push(`people count: ${analysis.people_count}`);
    }
    if (analysis.safe_person_notes) lines.push(`person notes: ${analysis.safe_person_notes}`);
    if (Array.isArray(analysis.warnings) && analysis.warnings.length) {
      lines.push(`warnings: ${analysis.warnings.join(' | ')}`);
    }
    if (analysis.confidence) lines.push(`confidence: ${analysis.confidence}`);
    if (analysis.metadata) {
      const width = analysis.metadata.width || '?';
      const height = analysis.metadata.height || '?';
      lines.push(`metadata: ${width}x${height} ${analysis.metadata.format || ''}`.trim());
    }
    if (analysis.raw_output) {
      lines.push('', 'raw output:', String(analysis.raw_output).slice(0, 4000));
    }
    return lines.join('\n');
  }

  async function showImageAnalysis(file, row) {
    const existing = row.querySelector('.vision-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const data = await GP.api(`/api/id/file/analysis?file_id=${encodeURIComponent(file.file_id)}`);
      const preview = document.createElement('pre');
      preview.className = 'document-preview vision-preview';
      preview.textContent = formatVisionAnalysis(data);
      row.appendChild(preview);
      GP.autoScroll();
    } catch (error) {
      GP.write(error.message || 'no image notes saved yet', 'error');
    }
  }

  async function analyzeImage(file, row) {
    const reviewing = GP.animatedStatusLine ? GP.animatedStatusLine('reviewing image') : null;
    try {
      const data = await GP.api(`/api/id/file/analyze?file_id=${encodeURIComponent(file.file_id)}`, { method: 'POST' });
      const existing = row.querySelector('.vision-preview');
      if (existing) existing.remove();
      const preview = document.createElement('pre');
      preview.className = 'document-preview vision-preview';
      preview.textContent = formatVisionAnalysis(data);
      row.appendChild(preview);
      if (reviewing) reviewing.remove();
      GP.write(`image notes saved: ${Files.fileName(file)}`);
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      GP.write(error.message || 'image analysis failed', 'error');
    }
  }

  Files.inspectDb3File = inspectDb3File;
  Files.askAiAboutFile = askAiAboutFile;
  Files.formatVisionAnalysis = formatVisionAnalysis;
  Files.showImageAnalysis = showImageAnalysis;
  Files.analyzeImage = analyzeImage;
})(window.GhostProtocol);
