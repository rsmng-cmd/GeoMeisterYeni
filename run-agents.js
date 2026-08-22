import { runDebuggerAgent } from './agents/debugger-agent.js';
import { runUIAnalyzer } from './agents/ui-analyzer-agent.js';
import { runInnovatorAgent } from './agents/innovator-agent.js';
import fs from 'fs';

async function main() {
  console.log('============ 🤖 GeoMeister Multi-Agent Sistem Başlatılıyor ============');
  
  const debugReport = await runDebuggerAgent();
  const uiReport = await runUIAnalyzer();
  const ideasReport = await runInnovatorAgent();
  
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  const reportFilename = 'agent-reports/report-' + dateStr + '.md';
  
  const fullReport = '# 🤖 GeoMeister Otonom Ajan Raporu\n' +
'**Tarih:** ' + now.toLocaleString('tr-TR') + '\n\n' +
'---\n\n' +
'## 🐛 1. Hata, Performans ve Yalınlaştırma (Otomatik Analiz)\n' + debugReport + '\n\n' +
'---\n\n' +
'## 🎨 2. UI/UX & Renk Kontrast Analizi\n' + uiReport + '\n\n' +
'---\n\n' +
'## 💡 3. Yeni Özellik ve Güncelleme Fikirleri (Onayınıza Sunulanlar)\n' + ideasReport + '\n\n' +
'---\n' +
'*Bu rapor GeoMeister Multi-Agent AI Sistemi tarafından otomatik oluşturulmuştur.*\n';

  fs.writeFileSync(reportFilename, fullReport, 'utf-8');
  console.log('\n========================================================================');
  console.log('🎉 Rapor Başarıyla Oluşturuldu: ' + reportFilename);
  console.log('========================================================================\n');
  console.log('📋 YENİ GÜNCELLEME VE FİKİR ÖNERİLERİ (ONAYINIZA SUNULANLAR):');
  console.log('--------------------------------------------------');
  console.log(ideasReport);
  console.log('--------------------------------------------------');
}

main().catch(err => {
  console.error('❌ Sistem Hatası:', err);
});
