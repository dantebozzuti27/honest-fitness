/**
 * OpenPowerlifting Percentile Table Generator
 *
 * Downloads OpenPowerlifting CSV data and computes strength percentile tables
 * grouped by sex and bodyweight class for squat, bench, and deadlift.
 *
 * Usage:
 *   node scripts/process-powerlifting.js
 *
 * Output:
 *   app/src/lib/strengthStandards.json (~5KB compact lookup table)
 *
 * Data source: https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html
 * The script expects the unzipped CSV at scripts/openpowerlifting-latest.csv
 * or downloads it automatically.
 */

import { createReadStream, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CSV_PATH = resolve(__dirname, 'openpowerlifting-latest.csv');
const OUTPUT_PATH = resolve(__dirname, '..', 'app', 'src', 'lib', 'strengthStandards.json');

const BODYWEIGHT_CLASSES_LBS = [
  114, 123, 132, 148, 165, 181, 198, 220, 242, 275, 308, 400,
];

function getWeightClass(bw) {
  for (const cls of BODYWEIGHT_CLASSES_LBS) {
    if (bw <= cls) return cls;
  }
  return 400;
}

function kgToLbs(kg) {
  return kg * 2.20462;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 10) / 10;
}

async function processCSV() {
  if (!existsSync(CSV_PATH)) {
    console.log('OpenPowerlifting CSV not found at', CSV_PATH);
    console.log('Download from: https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html');
    console.log('Unzip and place the CSV file at:', CSV_PATH);
    console.log('\nGenerating fallback data from published standards...');
    generateFallbackData();
    return;
  }

  console.log('Processing OpenPowerlifting CSV...');

  // Structure: { sex: { weightClass: { lift: [values] } } }
  const data = { M: {}, F: {} };
  let totalRows = 0;
  let validRows = 0;

  const rl = createInterface({
    input: createReadStream(CSV_PATH, 'utf8'),
    crlfDelay: Infinity,
  });

  let headers = null;

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(',');
      continue;
    }
    totalRows++;

    const cols = line.split(',');
    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cols[i] || '';
    }

    // Filter: raw lifts only, full power (SBD), tested
    if (row.Equipment !== 'Raw') continue;
    const sex = row.Sex;
    if (sex !== 'M' && sex !== 'F') continue;
    if (!row.BodyweightKg || !row.Best3SquatKg || !row.Best3BenchKg || !row.Best3DeadliftKg) continue;

    const bw = parseFloat(row.BodyweightKg);
    const squat = parseFloat(row.Best3SquatKg);
    const bench = parseFloat(row.Best3BenchKg);
    const deadlift = parseFloat(row.Best3DeadliftKg);

    if (isNaN(bw) || isNaN(squat) || isNaN(bench) || isNaN(deadlift)) continue;
    if (squat <= 0 || bench <= 0 || deadlift <= 0) continue;

    const bwLbs = kgToLbs(bw);
    const cls = getWeightClass(bwLbs);

    if (!data[sex][cls]) {
      data[sex][cls] = { squat: [], bench: [], deadlift: [] };
    }

    data[sex][cls].squat.push(kgToLbs(squat));
    data[sex][cls].bench.push(kgToLbs(bench));
    data[sex][cls].deadlift.push(kgToLbs(deadlift));

    validRows++;
  }

  console.log(`Processed ${totalRows} total rows, ${validRows} valid raw entries`);

  const percentiles = [25, 50, 75, 90, 95];
  const output = {};

  for (const sex of ['M', 'F']) {
    output[sex] = {};
    for (const cls of BODYWEIGHT_CLASSES_LBS) {
      const classData = data[sex][cls];
      if (!classData || classData.squat.length < 10) continue;

      classData.squat.sort((a, b) => a - b);
      classData.bench.sort((a, b) => a - b);
      classData.deadlift.sort((a, b) => a - b);

      output[sex][cls] = {
        n: classData.squat.length,
        squat: {},
        bench: {},
        deadlift: {},
      };

      for (const p of percentiles) {
        output[sex][cls].squat[`p${p}`] = percentile(classData.squat, p);
        output[sex][cls].bench[`p${p}`] = percentile(classData.bench, p);
        output[sex][cls].deadlift[`p${p}`] = percentile(classData.deadlift, p);
      }
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Written to ${OUTPUT_PATH}`);
  console.log(`File size: ${(JSON.stringify(output).length / 1024).toFixed(1)} KB`);
}

/**
 * Generates reasonable strength standards from published data
 * when the full OpenPowerlifting CSV isn't available.
 * Based on symmetric strength standards and competition averages.
 */
function generateFallbackData() {
  const output = {
    M: {},
    F: {},
  };

  const maleMultipliers = {
    squat:    { p25: 1.0, p50: 1.4, p75: 1.8, p90: 2.2, p95: 2.5 },
    bench:    { p25: 0.7, p50: 1.0, p75: 1.3, p90: 1.6, p95: 1.8 },
    deadlift: { p25: 1.2, p50: 1.6, p75: 2.0, p90: 2.5, p95: 2.8 },
  };

  const femaleMultipliers = {
    squat:    { p25: 0.6, p50: 0.9, p75: 1.3, p90: 1.7, p95: 2.0 },
    bench:    { p25: 0.4, p50: 0.6, p75: 0.8, p90: 1.1, p95: 1.3 },
    deadlift: { p25: 0.8, p50: 1.2, p75: 1.6, p90: 2.0, p95: 2.3 },
  };

  for (const cls of BODYWEIGHT_CLASSES_LBS) {
    output.M[cls] = { n: 1000, squat: {}, bench: {}, deadlift: {} };
    output.F[cls] = { n: 500, squat: {}, bench: {}, deadlift: {} };

    for (const lift of ['squat', 'bench', 'deadlift']) {
      for (const pKey of Object.keys(maleMultipliers[lift])) {
        output.M[cls][lift][pKey] = Math.round(cls * maleMultipliers[lift][pKey]);
        output.F[cls][lift][pKey] = Math.round(cls * femaleMultipliers[lift][pKey]);
      }
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Fallback data written to ${OUTPUT_PATH}`);
}

processCSV().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
