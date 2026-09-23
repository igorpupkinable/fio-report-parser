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
const FIRST_COLUMN_HEADER = 'Name';
const MIXED = 'mixed';
const RANDOM = 'rand';
const UNSUPPORTED_TYPE = '_UNSUPPORTED_';

const removeEscapeSequence = (str) => str.replace(/\x1b\[\d+m/g, '');
const drawTable = (table) => {
  const thead = table.reduce(
    (acc, row) => {
      Object.entries(row).forEach(([k, v]) => {
        const keyLength = k.length;
        const valueLength = removeEscapeSequence(v.toString()).length;
        const l = keyLength > valueLength ? keyLength : valueLength;

        if (!acc[k] || acc[k] < l) {
          acc[k] = l;
        }
      });

      return acc;
    },
    {},
  );
  const tbody = table.reduce(
    (acc, row) => {
      const tr = {};

      Object.entries(row).forEach(([k, v]) => {
        const val = v.toString();
        const targetLength = val.length - removeEscapeSequence(val).length + thead[k];

        tr[k] = val[k === FIRST_COLUMN_HEADER ? 'padEnd' : 'padStart'](targetLength);
      });
      acc.push(tr);

      return acc;
    },
    [],
  );
  const lanes = [
    ['┌'],
    ['│'],
    ['├'],
    ...Array.from(
      { length: tbody.length },
      () => ['│'], // Must be new array for each lane.
    ),
    ['└'],
  ];
  const tfootIndex = lanes.length - 1;

  // Populate table with header, rows and footer.
  Object.entries(thead).forEach(([k, v]) => {
    lanes[0].push('─'.repeat(v + 2), '┬'); // +2 = spaces before and after column label.
    lanes[1].push(` ${k.padEnd(v)} `, '│');
    lanes[2].push('─'.repeat(v + 2), '┼');
    tbody.forEach((td, index) => {
      lanes[3 + index].push(` ${td[k] ?? ''.padEnd(v)} `, '│');
    });
    lanes[tfootIndex].push('─'.repeat(v + 2), '┴');
  });

  lanes[0] = lanes[0].with(-1, '┐');
  lanes[2] = lanes[2].with(-1, '┤');
  lanes[tfootIndex] = lanes[tfootIndex].with(-1, '┘');

  lanes.forEach((line) => {
    console.log(line.join(''));
  });
};
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
const table = [];

delete jobGroups[UNSUPPORTED_TYPE];
Object.entries(jobGroups).forEach(([k, v]) => {
  table.push({
    [FIRST_COLUMN_HEADER]: `\x1b[100m[${k.toUpperCase()}]\x1b[0m`,
  });
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

    table.push({
      [FIRST_COLUMN_HEADER]: `${intensity}${jobname.replace('{qd}', iodepth).replace('{t}', numjobs)}\x1b[0m`,
      'IO pattern': `${intensity}${pattern}\x1b[0m`,
      'Block size': `${intensity}${bs}\x1b[0m`,
      'Queue depth': `${intensity}${iodepth}\x1b[0m`,
      'Threads': `${intensity}${numjobs}\x1b[0m`,
      'MB/s': `${intensity}\x1b[95m${kiBtoMib(bw).toFixed(2)}\x1b[0m`,
      'IOPS': `${intensity}\x1b[94m${Math.round(iops)}\x1b[0m`,
      'Min latency (ms)': `${intensity}\x1b[92m${ns2ms(latencyMin).toFixed(1)}\x1b[0m`,
      'Mean latency (ms)': `${intensity}\x1b[93m${ns2ms(latencyMean).toFixed(1)}\x1b[0m`,
      'Max latency (ms)': `${intensity}\x1b[91m${ns2ms(latencyMax).toFixed(1)}\x1b[0m`,
    });
  });
});

drawTable(table);
