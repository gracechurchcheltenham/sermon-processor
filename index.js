/* eslint no-param-reassign: 0 */
/* eslint no-console: 0 */  // --> AWS Lambda expects native console commands

/*
 * IAM role requirements: S3_ReadOnly, SNS_Publish, CloudWatch:Logs
 */

'use strict';

const AWS = require('aws-sdk');
const waterfall = require('async/waterfall');
const nodeID3 = require('node-id3');
const dotenv = require('dotenv');

dotenv.config();

// TODO: Use KMS to protect env vars

AWS.config.update({
  region: process.env.AWS_REGION,
});

const PUBLISH_ARN = process.env.SNS_TOPIC_ARN;


function extractID3(data, callback) {
  console.log('Extracting ID3 tags...');

  const tags = nodeID3.read(data.Body);
  if (!tags) {
    return callback('No ID3 tags extracted. Can\'t continue.');
  }

  console.log(tags);

  if (tags.image) delete tags.image;

  const array = {};
  array.tags = tags;
  array.filename = data.location;

  return callback(null, array);
}


function download(_params, callback) {
  console.log('Downloading...');

  const s3 = new AWS.S3({
    region: _params.Region,
  });

  const params = {
    Bucket: _params.Bucket,
    Key: _params.Key,
  };

  console.log(`s3://${params.Bucket}/${params.Key}`);
  s3.getObject(params, (error, data) => {
    if (error) {
      console.log(error);
      return callback(error);
    }

    data.location = `http://${params.Bucket}/${params.Key}`;
    return callback(null, data);
  });
}


function processDate(data, callback) {
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

    if (process.env.NODE_ENV !== 'production') {
      console.log(data.sermonDate);
    }
  }

  callback(null, data);
}


function processTags(data, callback) {
  console.log('Processing ID3 tags');

  if (data.tags.subtitle) {
    // split subtitle tag into seperate passages
    const arr = data.tags.subtitle.split(';');
    data.tags.subtitle = arr.map(s => s.trim());


    if (process.env.NODE_ENV !== 'production') {
      console.log(data.tags.subtitle);
    }
  }
  callback(null, data);
}


function addMetadataToS3(data, callback) {
  console.log('Adding extracted metadata to S3');

  // TODO: Add all extracted tags to S3 as file metadata
  // http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property

  return callback(null, data);
}


function sendSNS(data, callback) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Skipping SNS as not in production.');
    return callback(null, data);
  }

  const sns = new AWS.SNS();
  sns.publish({
    TargetArn: PUBLISH_ARN,
    Message: JSON.stringify(data),
    Subject: 'Sermon uploaded',
  }, (error, response) => {
    if (error) {
      console.log('SNS message failed to send');
      console.error(error);
      return callback(error);
    }

    console.log('SNS message sent');
    return callback(null, response);
  });

  return null;
}


console.log('Fresh environment. Loading module for 1st time.');
exports.handler = (event, context, cb) => {
  waterfall([
    function start(callback) {
      const params = {
        Region: event.Records[0].awsRegion,
        Bucket: event.Records[0].s3.bucket.name,
        Key: event.Records[0].s3.object.key,
      };

      download(params, callback);
    },
    extractID3,
    processDate,
    processTags,
    addMetadataToS3,
    sendSNS,
  ],

  (error, result) => {
    console.log('end of the waterfall');
    if (error) {
      console.error(error);
    }

    return cb(error, result);
  });
};
