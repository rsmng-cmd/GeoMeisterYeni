import { getModel } from './config.js';
import fs from 'fs';
import path from 'path';

export async function runDebuggerAgent(logCb) {
  const log = (msg, type='info') => {
    console.log(msg);
    if (logCb) logCb('Debugger Agent', msg, type);
  };

  log('🐛 [Debugger Agent] Kod tabanındaki hatalar ve performans sorunları taranıyor...');
  const appJsPath = path.join(process.cwd(), 'src/app.js');
  const code = fs.readFileSync(appJsPath, 'utf-8');
  const prompt = 'Görevin: GeoMeister oyununun app.js kodunu inceleyip performans düşüren, kasma yapabilecek veya potansiyel runtime hatası (NPE, memory leak, unhandled promise) barındıran kısımları bulmak. Sadece Türkçe özet ve düzeltme önerisi sun.\n\nKod:\n' + code.substring(0, 5000);
  
  log('📤 [PROMPT SORGUSU GÖNDERİLDİ]: ' + prompt.substring(0, 150) + '...', 'prompt');

  try {
    const model = getModel();
    const res = await model.generateContent(prompt);
    log('  ✅ Hata ve Performans Analizi tamamlandı.', 'success');
    return res.response.text();
  } catch (err) {
    log('  ❌ Debugger Hatası: ' + err.message, 'error');
    return 'Debugger Hatası.';
  }
}
