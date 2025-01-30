const jobTitles = {
  read: 'sequential read',
  write: 'sequential write',
  randread: 'random read',
  randwrite: 'random write',
  rw: 'sequential mixed read and write',
  // readwrite': 'sequential mixed read and write',
  randrw: 'random mixed read and write',
};
const cacheTitles = {
  '0': 'Buffered I/O',
  '1': 'Non-buffered I/O (this is usually O_DIRECT)',
};

const ns2ms = (ns) => ns / 1000000;

if (process.argv.length === 2) {
  console.error('Please provide FIO test results in JSON format.');
  console.log('Example: node report.js ./path/to/report.json');

  process.exit(1);
}

let filepath = process.argv[2];

if (!(filepath.startsWith('./') || filepath.startsWith('/'))) {
  filepath = `./${filepath}`;
}

console.info(`Parsing ${filepath}`);

const report = require(filepath);

const globalOptions = report['global options'];

console.info(`Tests were executed in ${globalOptions.directory}`);
console.info(`${cacheTitles[globalOptions?.direct ?? 0]} was used in tests.\n`);

const { errors, jobs } = report.jobs.reduce(
  (acc, job) => {
    if (job.error > 0) {
      acc.errors.push(job);
    } else {
      acc.jobs.push(job);
    }

    return acc;
  },
  {
    errors: [],
    jobs: [],
  },
);

if (errors.length > 0) {
  console.warn(`Jobs with errors: ${errors.length}`);
  console.log('--------------------------------------------------');

  errors.forEach(({ jobname: name }) => {
    console.warn(`${name} job has error. Skipping.`);
  });

  console.log('\n');
}

if (jobs.length > 0) {
  console.info(`Successful jobs: ${jobs.length}`);
  console.log('--------------------------------------------------');

  const jobGroups = jobs.reduce(
    (acc, job) => {
      const jobOptions = job['job options'];
      const groupName = jobOptions.rw;
      const group = acc[groupName];

      if (groupName.length > 1 && Array.isArray(group)) {
        job.iodepth = jobOptions.iodepth ?? globalOptions.iodepth;
        group.push(job);
      } else {
        console.warn(`Unsupported job type found: ${groupName}. Skipping.`);
      }

      return acc;
    },
    {
      read: [],       // Sequential reads.
      write: [],      // Sequential writes.
      randread: [],   // Random reads.
      randwrite: [],  // Random writes.
      rw: [],         // Sequential mixed reads and writes.
      // readwrite: [],  // Sequential mixed reads and writes.
      randrw: [],     // Random mixed reads and writes.

      // SSD tests. Not supported yet.
      // trim: [],           // Sequential trims (Linux block devices and SCSI character devices only).
      // randtrim: [],       // Random trims (Linux block devices and SCSI character devices only).
      // trimwrite: [],      // Sequential trim+write sequences.
      // randtrimwrite: [],  // Like trimwrite, but uses random offsets rather than sequential writes.
    },
  );

  Object.keys(jobGroups).forEach((groupName) => {
    const group = jobGroups[groupName];

    if (group.length > 0) {
      console.info(`${group.length} ${jobTitles[groupName]} performance tests.`);
    } else {
      delete jobGroups[groupName];
    }
  });

  Object.keys(jobGroups).forEach((groupName) => {
    const group = jobGroups[groupName];

    console.info(`\nResults for ${jobTitles[groupName]} tests`);

    group.forEach((job) => {
      const {
        iodepth,
        jobname,
        read: {
          bw: readBw,
          clat_ns: {
            max: readLatencyMax,
            mean: readLatencyMean,
            min: readLatencyMin,
          },
          iops: readIops,
        },
        write: {
          bw: writeBw,
          clat_ns: {
            max: writeLatencyMax,
            mean: writeLatencyMean,
            min: writeLatencyMin,
          },
          iops: writeIops,
        },
      } = job;
      const readBandwidth = readBw / 1024;
      const writeBandwidth = writeBw / 1024;
      const name = groupName.replace('rand', '');

      if (name == 'read' || name == 'rw') {
        console.info(`${jobname}\tQD${iodepth}\tRead\t${readBandwidth.toFixed(2)}\tMB/s\t${readIops.toFixed(0)}\tIOPS\tLatency (min/mean/max)\t${ns2ms(readLatencyMin).toFixed(1)}\tms\t${ns2ms(readLatencyMean).toFixed(1)}\tms\t${ns2ms(readLatencyMax).toFixed(1)}\tms`);
      }

      if (name == 'write' || name == 'rw') {
        console.info(`${jobname}\tQD${iodepth}\tWrite\t${writeBandwidth.toFixed(2)}\tMB/s\t${writeIops.toFixed(0)}\tIOPS\tLatency (min/mean/max)\t${ns2ms(writeLatencyMin).toFixed(1)}\tms\t${ns2ms(writeLatencyMean).toFixed(1)}\tms\t${ns2ms(writeLatencyMax).toFixed(1)}\tms`);
      }
    });
  });

  console.log('\n');
} else {
  console.info('No successful jobs found.');
}

console.info('DONE');
