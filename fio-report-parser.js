const JOB_TITLE = {
  read: 'sequential read',
  write: 'sequential write',
  randread: 'random read',
  randwrite: 'random write',
  // rw: 'sequential mixed read and write',
  // readwrite': 'sequential mixed read and write',
  // randrw: 'random mixed read and write',
};
const CACHE_TITLE = {
  '0': 'Buffered I/O',
  '1': 'Non-buffered I/O (this is usually O_DIRECT)',
};
const OPERATION_LABEL = {
  read: 'Read',
  write: 'Write',
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

const parsingTitle = `Parsing ${filepath}`;

console.time(parsingTitle);

const report = require(filepath);

console.timeEnd(parsingTitle);

const globalOptions = report['global options'];

console.info(`Tests were executed in ${globalOptions.directory}`);
console.info(`${CACHE_TITLE[globalOptions?.direct ?? 0]} was used in tests.\n`);

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
  console.group(`Successful jobs: ${jobs.length}`);

  const jobGroups = jobs.reduce(
    (acc, job) => {
      const jobOptions = job['job options'];
      const groupName = jobOptions.rw;
      const group = acc[groupName];

      if (groupName.length > 1 && Array.isArray(group)) {
        job.iodepth = jobOptions.iodepth ?? globalOptions.iodepth;
        job.threads = jobOptions.numjobs;
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
      // rw: [],         // Sequential mixed reads and writes.
      // readwrite: [],  // Sequential mixed reads and writes.
      // randrw: [],     // Random mixed reads and writes.

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
      console.info(`${group.length} ${JOB_TITLE[groupName]} performance tests.`);
    } else {
      delete jobGroups[groupName];
    }
  });
  console.groupEnd();

  Object.keys(jobGroups).forEach((groupName) => {
    const group = jobGroups[groupName];

    console.group(`\nResults for ${JOB_TITLE[groupName]} tests`);

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
        threads,
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
      const name = groupName.replace('rand', '');

      let bandwidth;
      let iops;
      let latencyMax;
      let latencyMean;
      let latencyMin;

      if (name == 'read') {
        bandwidth = readBw / 1024;
        iops = readIops;
        latencyMax = ns2ms(readLatencyMax);
        latencyMean = ns2ms(readLatencyMean);
        latencyMin = ns2ms(readLatencyMin);
      }

      if (name == 'write') {
        bandwidth = writeBw / 1024;
        iops = writeIops;
        latencyMax = ns2ms(writeLatencyMax);
        latencyMean = ns2ms(writeLatencyMean);
        latencyMin = ns2ms(writeLatencyMin);
      }

      console.info(`${jobname} \tQD${iodepth}\t${OPERATION_LABEL[name]}\t${bandwidth.toFixed(2)}\tMB/s\t${iops.toFixed(0)}\tIOPS\tLatency (min/mean/max)\t${latencyMin.toFixed(1)}\tms\t${latencyMean.toFixed(1)}\tms\t${latencyMax.toFixed(1)}\tms`);
    });

    console.groupEnd();
  });

  console.log('\n');
} else {
  console.info('No successful jobs found.');
}

console.info('DONE');
