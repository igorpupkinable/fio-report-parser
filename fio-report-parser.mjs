import { cwd } from 'node:process';
import { table } from 'table';
import path from 'node:path';

/*
SSD tests. Not supported yet.
  - trim: sequential trims (Linux block devices and SCSI character devices only)
  - randtrim: random trims (Linux block devices and SCSI character devices only)
  - trimwrite: sequential trim+write sequences
  - randtrimwrite: like trimwrite, but uses random offsets rather than sequential writes
*/
const CLIARGS = process.argv;
const CACHE_TITLE = {
  '0': 'Buffered I/O',
  '1': 'Non-buffered I/O (this is usually O_DIRECT)',
};
const HEADERS = [
  'Name',
  'IO pattern',
  'Block size',
  'Queue depth',
  'Threads',
  'MB/s',
  'IOPS',
  'Min latency (ms)',
  'Mean latency (ms)',
  'Max latency (ms)',
];
const IO_PATTERN = {
  randread: 'Random read',
  randrw: 'Random mixed',
  randwrite: 'Random write',
  read: 'Sequential read',
  readwrite: 'Sequential mixed',
  rw: 'Sequential mixed',
  write: 'Sequential write',
  // trim: sequential trims (Linux block devices and SCSI character devices only)
  // randtrim: random trims (Linux block devices and SCSI character devices only)
  // trimwrite: sequential trim+write sequences
  // randtrimwrite: like trimwrite, but uses random offsets rather than sequential writes
};
const MIXED = 'mixed';
const RANDOM = 'rand';
const UNSUPPORTED_TYPE = '_UNSUPPORTED_';

const kiBtoMib = (kiB) => kiB / 1024;
const ns2ms = (ns) => ns / 1000000;

if (CLIARGS.length === 2) {
  const baseFilename = path.basename(import.meta.url);

  console.error('\x1b[31m%s\x1b[0m', 'Please provide FIO test results in JSON format.');
  console.log('\x1b[33mExamples:\x1b[0m');
  console.log('\t', `node ${baseFilename} ../path/to/report.json`);
  console.log('\t', `node ${baseFilename} ~/path/to/report.json`);

  process.exit(1);
}

const REPORT_FILEPATH = CLIARGS[2];

const parsingMessage = `Parsing ${REPORT_FILEPATH}`;

console.time(parsingMessage);

const { default: report } = await import(
  path.resolve(cwd(), REPORT_FILEPATH),
  { with: { type: 'json' } },
);

console.timeEnd(parsingMessage);

const globalOptions = report['global options'];

console.info(`Tests were executed in ${globalOptions.directory}`);
console.info('\x1b[1m%s\x1b[0m', CACHE_TITLE[globalOptions?.direct ?? 0], 'was used in tests.\n');

const jobs = report.jobs.reduce(
  (
    acc,
    {
      error,
      'job options': options,
      jobname,
      read,
      write,
    },
  ) => {
    if (error > 0) {
      console.warn('\x1b[33m%s\x1b[0m', `${jobname} job has error. Skipping...`);
    } else {
      let type;

      switch (options.rw) {
        // Read
        case 'randread':
        case 'read':
          type = read;
          break;
        // Write
        case 'randwrite':
        case 'write':
          type = write;
          break;
        // Mixed
        case 'randrw':
        case 'readwrite':
        case 'rw':
          type = MIXED;
          break;
        default:
          console.error(`\x1b[1m\x1b[41mUnsupported job found: ${jobname} of type ${options.rw}. Skipping...\x1b[0m`);
      }

      const job = Object.assign(
        {
          jobname,
        },
        globalOptions,
        options,
      );

      if (type === MIXED) {
        acc.push({ // Add 'read' part of a mixed job
          ...job,
          ...read,
          pattern: IO_PATTERN[job.rw],
          rw: `${MIXED}read`,
        });
        acc.push({ // Add 'write' part of a mixed job
          ...job,
          ...write,
          pattern: IO_PATTERN[job.rw],
          rw: `${MIXED}write`,
        });
      } else {
        acc.push({
          ...job,
          ...type,
          pattern: IO_PATTERN[job.rw],
        });
      }
    }

    return acc;
  },
  [],
);

if (jobs.length > 0) {
  console.info('\x1b[32m%s\x1b[0m', `${jobs.length} successful jobs found.`);
} else {
  console.info('\x1b[31m%s\x1b[0m', 'No successful jobs found.');
  process.exit();
}

const jobGroups = Object.groupBy(jobs, ({ rw }) => {
  if (IO_PATTERN[rw] && rw.startsWith(RANDOM)) {
    return rw.replace(RANDOM, '');
  } else if (IO_PATTERN[rw]) {
    return rw;
  }

  if (rw.startsWith(MIXED)) {
    return rw.replace(MIXED, '');
  }

  console.warn('\x1b[33m%s\x1b[0m', `Skip unsupported job type: ${rw}`);

  return UNSUPPORTED_TYPE;
});

delete jobGroups[UNSUPPORTED_TYPE];

const ALIGNMENT_LEFT = 'left';
const TABLE_CONFIG = {
  columnDefault: {
    alignment: 'right',
  },
  columns: [
    { alignment: ALIGNMENT_LEFT },
    {}, // IO pattern
    { width: HEADERS[2].length },
    { width: HEADERS[3].length },
    { width: HEADERS[4].length },
    {}, // Bandwidth
    {}, // IOPS
    { width: HEADERS[7].length },
    { width: HEADERS[8].length },
    { width: HEADERS[9].length },
  ],
  drawHorizontalLine: (lineIndex, rowCount) => {
    return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
  },
  spanningCells: HEADERS.map((header, index) => ({ col: index, row: 0, colSpan: 1, alignment: index === 0 ? ALIGNMENT_LEFT : 'center' }))
};
const tableData = [HEADERS];

Object.entries(jobGroups).forEach(([k, v]) => {
  v.forEach(({
    bs,
    bw,
    clat_ns: {
      max: latencyMax,
      mean: latencyMean,
      min: latencyMin,
    },
    iodepth = 1,
    iops,
    jobname,
    numjobs = 1,
    pattern,
    rw,
  }) => {
    let intensity = '\x1b[97m'; // Bright or increased intensity

    if (rw.startsWith(MIXED)) {
      intensity = '\x1b[2m'; // Faint or decreased intensity
    }

    if (rw.startsWith(RANDOM)) {
      intensity = ''; // Normal intensity
    }

    tableData.push([
      `${intensity}${jobname.replace('{qd}', iodepth).replace('{t}', numjobs)}\x1b[0m`,
      `${intensity}${pattern}\x1b[0m`,
      `${intensity}${bs}\x1b[0m`,
      `${intensity}${iodepth}\x1b[0m`,
      `${intensity}${numjobs}\x1b[0m`,
      `${intensity}\x1b[95m${kiBtoMib(bw).toFixed(2)}\x1b[0m`,
      `${intensity}\x1b[94m${Math.round(iops)}\x1b[0m`,
      `${intensity}\x1b[92m${ns2ms(latencyMin).toFixed(1)}\x1b[0m`,
      `${intensity}\x1b[93m${ns2ms(latencyMean).toFixed(1)}\x1b[0m`,
      `${intensity}\x1b[91m${ns2ms(latencyMax).toFixed(1)}\x1b[0m`,
    ]);
  });
});

console.log(table(
  tableData,
  TABLE_CONFIG,
));
