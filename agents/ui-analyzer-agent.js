import { getModel } from './config.js';
import fs from 'fs';
import path from 'path';

export async function runUIAnalyzer(logCb) {
  const log = (msg, type='info') => {
    console.log(msg);
    if (logCb) logCb('UI/UX Analyzer', msg, type);
  };

  log('🎨 [UI/UX Analyzer Agent] Arayüz ve renk uyumu taranıyor...');
  const indexPath = path.join(process.cwd(), 'index.html');
  const html = fs.readFileSync(indexPath, 'utf-8');
  const prompt = 'GeoMeister index.html dosyasını analiz et. Görsel açıdan gözü yoran, kontrastı düşük veya ayırt edilmesi zor buton/metin renklerini Türkçe raporla.\n\nHTML:\n' + html.substring(0, 4000);

  log('📤 [PROMPT SORGUSU GÖNDERİLDİ]: ' + prompt.substring(0, 150) + '...', 'prompt');

  try {
    const model = getModel();
    const res = await model.generateContent(prompt);
    log('  ✅ UI/UX Analizi tamamlandı.', 'success');
    return res.response.text();
  } catch (err) {
    log('  ❌ UI Analyzer Hatası: ' + err.message, 'error');
    return 'UI Analiz hatası.';
  }
}
