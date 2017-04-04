/* eslint no-param-reassign: 0 */
/* eslint no-console: 0 */  // --> AWS Lambda expects native console commands

/*
 * IAM role requirements: S3_ReadOnly, SNS_Publish, CloudWatch:Logs
 */

const AWS = require('aws-sdk');
const async = require('async');
const temp = require('temp').track();
const id3 = require('id3_reader');
const dotenv = require('dotenv');

dotenv.config();

AWS.config.update({
  region: process.env.AWS_REGION,
});


const PUBLISH_ARN = process.env.SNS_TOPIC_ARN;

export default {
  handler(event, context, cb) {
    async.waterfall([
      function start(callback) {
        const params = {
          Region: event.Records[0].awsRegion,
          Bucket: event.Records[0].s3.bucket.name,
          Key: event.Records[0].s3.object.key,
        };

        this.download(params, callback);
      },
      this.extractID3,
      this.processDate,
      this.processTags,
      this.sendSNS,
      (err, result) => {
        temp.cleanup();

        if (err) {
          console.error(err);
          cb(err);
        } else {
          cb.succeed(null, result);
        }
      },
    ]);
  },

  /**
   * Extract ID3 tags from an MP3 filepath
   **/
  extractID3(data, callback) {
    console.log('Extracting ID3 tags...');
    id3.read(data.filepath, (err, tags) => {
      if (err) {
        console.error(err);
        callback(err);
      } else {
        const array = {};
        array.tags = tags;
        array.filename = data.orig_filename;
        callback(null, array);
      }
    });
  },


  download(params, callback) {
    console.log('Downloading...');

    const s3 = new AWS.S3({
      region: params.Region,
    });

    const req = s3.getObject(params);
    const tmpfile = temp.createWriteStream();

    const response = {};
    response.filepath = tmpfile.path;
    response.orig_filename = `http://${params.Bucket}/${params.Key}`;
    response.s3Params = params;

    console.log('Storing file temporarily at: ', response.filepath);

    tmpfile.on('close', () =>
      callback(null, response),
    );

    req.on('error', res =>
      callback(res.error),
    );

    req.createReadStream().pipe(tmpfile);
  },


  processDate(data, callback) {
    console.log('Attempting to extract date from ID3 tags...');

    const separator = '-';
    const dateReg = /\d{4}-\d{2}-\d{2}/;

    const d = data.filename.match(dateReg);

    // if we find the date in the string, parse it
    // if not, skip (leave it to be added manually)
    if (d !== null) {
      const parts = d[0].split(separator);
      const year = parts[0];
      const month = parts[1];
      const day = parts[2];

      data.sermonDate = {};
      data.sermonDate.year = year;
      data.sermonDate.month = month;
      data.sermonDate.day = day;
    }

    callback(null, data);
  },


  processTags(data, callback) {
    console.log('Processing ID3 tags');

    if (data.tags.subtitle) {
      // split subtitle tag into seperate passages
      const arr = data.tags.subtitle.split(';');
      data.tags.subtitle = arr.map(s =>
        s.trim(),
      );
    }

    callback(null, data);
  },


  sendSNS(data, callback) {
    const sns = new AWS.SNS();

    sns.publish({
      TargetArn: PUBLISH_ARN,
      Message: JSON.stringify(data),
      Subject: 'Sermon uploaded',
    }, (err, response) => {
      if (err) {
        console.log('SNS message failed to send');
        console.error(err);
        callback(err);
      } else {
        console.log('SNS message sent');
        callback(null, response);
      }
    });
  },
};
