// split_file.js
// Uso: node split_file.js <ruta_video|audio> <output_folder>
// Requiere tener FFmpeg instalado en el sistema
// Uso local: node split_file.js "/mnt/c/Users/Dominique/Downloads/audio_presentacion_5min.mp3" ./chunks

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [,, inputFile, outputDir] = process.argv;

if (!inputFile || !outputDir) {
  console.error('Uso: node split_video.js <ruta_video|audio> <output_folder>');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Detecta la extensión del archivo de entrada para usar la misma en los chunks
const ext = path.extname(inputFile).toLowerCase();
let outputPattern;
if (ext === '.mp3') {
  outputPattern = `${outputDir}/chunk_%03d.mp3`;
} else if (ext === '.mp4') {
  outputPattern = `${outputDir}/chunk_%03d.mp4`;
} else {
  console.error('Formato no soportado. Usa un archivo .mp4 o .mp3');
  process.exit(1);
}

try {
  // Divide el archivo en chunks de 2 minutos (120 segundos)
  execSync(`ffmpeg -i "${inputFile}" -c copy -map 0 -segment_time 120 -f segment -reset_timestamps 1 "${outputPattern}"`, { stdio: 'inherit' });
  console.log('Archivo dividido exitosamente en chunks de 2 minutos.');
} catch (err) {
  console.error('Error al dividir el archivo:', err.message);
  process.exit(1);
}
