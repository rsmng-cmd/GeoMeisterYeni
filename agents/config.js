import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('HATA: .env dosyasında GEMINI_API_KEY bulunamadı!');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

export const DEFAULT_MODEL = 'gemini-flash-lite-latest';

export function getModel(modelName = DEFAULT_MODEL, systemInstruction = '') {
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
  });
}
