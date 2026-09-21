const { resolve } = require('node:path');
const { cwd } = require('node:process');

/*
Unsupported job types:
  - rw: sequential mixed reads and writes
  - readwrite: same as above
  - randrw: random mixed reads and writes

SSD tests. Not supported yet.
  - trim: sequential trims (Linux block devices and SCSI character devices only)
  - randtrim: random trims (Linux block devices and SCSI character devices only)
  - trimwrite: sequential trim+write sequences
  - randtrimwrite: like trimwrite, but uses random offsets rather than sequential writes
*/
const IO_PATTERN = {
  read: 'Sequential read',
  write: 'Sequential write',
  randread: 'Random read',
  randwrite: 'Random write',
  // rw: 'sequential mixed read and write',
  // readwrite: 'sequential mixed read and write',
  // randrw: 'random mixed read and write',
  // trim: sequential trims (Linux block devices and SCSI character devices only)
  // randtrim: random trims (Linux block devices and SCSI character devices only)
  // trimwrite: sequential trim+write sequences
  // randtrimwrite: like trimwrite, but uses random offsets rather than sequential writes
};
const CACHE_TITLE = {
  '0': 'Buffered I/O',
  '1': 'Non-buffered I/O (this is usually O_DIRECT)',
};
const UNSUPPORTED_TYPE = '_UNSUPPORTED_';
const FIRST_COLUMN_HEADER = 'Name';
const RANDOM = 'rand';

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

if (process.argv.length === 2) {
  console.error('\x1b[31m%s\x1b[0m', 'Please provide FIO test results in JSON format.');
  console.log('\x1b[33mExample:\x1b[0m %s', `node ${__filename} ./path/to/report.json`);

  process.exit(1);
}

let filepath = process.argv[2];

if (!(filepath.startsWith('./') || filepath.startsWith('/'))) {
  filepath = `./${filepath}`;
}

const parsingMessage = `Parsing ${filepath}`;

console.time(parsingMessage);

const report = require(resolve(cwd(), filepath));

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
        case 'read':
        case 'randread':
          type = read;
          break;
        case 'write':
        case 'randwrite':
          type = write;
          break;
        default:
          console.error(`\x1b[1m\x1b[41mUnsupported job found: ${jobname} of type ${options.rw}. Skipping...\x1b[0m`);
      }

      acc.push({
        ...globalOptions,
        ...options,
        ...type,
        jobname,
      });
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
  if (IO_PATTERN[rw]) {
  } else {
    console.warn('\x1b[33m%s\x1b[0m', `Skip unsupported job type: ${rw}`);
    return rw.replace(RANDOM, '');

    return UNSUPPORTED_TYPE;
  }
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
    rw,
  }) => {
    const dim = rw.startsWith('rand') ? '\x1b[2m' : '';

    table.push({
      [FIRST_COLUMN_HEADER]: `${dim}${jobname.replace('{qd}', iodepth).replace('{t}', numjobs)}\x1b[0m`,
      'IO pattern': `${dim}${IO_PATTERN[rw]}\x1b[0m`,
      'Block size': `${dim}\x1b[90m${bs}\x1b[0m`,
      'Queue depth': `${dim}${iodepth}\x1b[0m`,
      'Threads': `${dim}${numjobs}\x1b[0m`,
      'MB/s': `${dim}\x1b[35m${kiBtoMib(bw).toFixed(2)}\x1b[0m`,
      'IOPS': `${dim}\x1b[33m${Math.round(iops)}\x1b[0m`,
      'Min latency (ms)': `${dim}\x1b[34m${ns2ms(latencyMin).toFixed(1)}\x1b[0m`,
      'Mean latency (ms)': `${dim}\x1b[34m${ns2ms(latencyMean).toFixed(1)}\x1b[0m`,
      'Max latency (ms)': `${dim}\x1b[34m${ns2ms(latencyMax).toFixed(1)}\x1b[0m`,
    });
  });
});

drawTable(table);
