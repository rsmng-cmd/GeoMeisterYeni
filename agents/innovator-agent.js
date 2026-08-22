import { getModel } from './config.js';

export async function runInnovatorAgent(logCb) {
  const log = (msg, type='info') => {
    console.log(msg);
    if (logCb) logCb('Innovator Agent', msg, type);
  };

  log('💡 [Innovator Agent] Oyun içi yeni fikirler ve iyileştirmeler üretiliyor...');
  const prompt = 'Görevin: GeoMeister (Coğrafya/Tahmin oyunu) için oyunun akıcılığını bozmayacak, mobil cihazlarda kasma yapmayacak 3 adet yenilikçi özellik veya oyun modu fikri üretmek. Türkçe yanıt ver ve her fikri kısa ve net açıkla.';

  log('📤 [PROMPT SORGUSU GÖNDERİLDİ]: ' + prompt, 'prompt');

  try {
    const model = getModel();
    const res = await model.generateContent(prompt);
    log('  ✅ Fikir Üretimi tamamlandı.', 'success');
    return res.response.text();
  } catch (err) {
    log('  ❌ Innovator Hatası: ' + err.message, 'error');
    return 'Innovator Hatası.';
  }
}
