/*
* IAM role requirements: S3_ReadOnly, SNS_Publish, CloudWatch:Logs
*/

"use strict";

var AWS = require('aws-sdk');
AWS.config.update({region: process.env.AWS_REGION});

var async = require('async');
var temp = require('temp').track();

if( process.env.NODE_ENV == 'development') {
	require('dotenv').config();
}

const PUBLISH_ARN = process.env.PUBLISH_ARN || "arn:aws:sns:" + process.env.AWS_REGION + ":" + process.env.AWS_ACCOUNT_ID + ":" + process.env.SNS_TOPIC;

var self = module.exports = {
	handler: function(event, context) {
		async.waterfall([
			function start(callback) {
				var params = {
					Bucket: event.Records[0].s3.bucket.name,
					Key: event.Records[0].s3.object.key
				};

				self.download(params, callback);
			},
			self.extractID3,
			self.processDate,
			self.processTags,
			self.sendSNS,
			function finishUp(data, next) {
				temp.cleanup();
				context.succeed();
			},
			function (err) {
				if (err) {
					temp.cleanup();
					console.error(err);
					context.fail();
				}
			}
		]);
	},

	/**
	 * Extract ID3 tags from an MP3 filepath
	 **/
	extractID3: function(data, callback) {
		var id3 = require("id3_reader");

		console.log("Extracting ID3 tags...");
		id3.read(data.filepath, function(err, tags) {
			if(err) {
				console.error(err);
				callback(err);
			} else {
				var array = new Object();
				array.tags = tags;
				array.filename = data.orig_filename;
				callback(null, array);
			}
		});
	},



	download: function(params, callback) {
		console.log("Downloading...");

		var s3 = new AWS.S3();

		var req = s3.getObject(params);
		var tmpfile = temp.createWriteStream();

		var response = {};
		response.filepath = tmpfile.path;
		response.orig_filename = 'http://' + params.Bucket + '/' + params.Key;
		response.s3Params = params;

		console.log("Storing file temporarily at: ", response.filepath);

		tmpfile.on('close', function() {
			callback(null, response);
			return;
		});

		req.on('error', function(response) {
			callback(response.error);
			return;
		});

		req.createReadStream().pipe(tmpfile);
	},


	processDate: function(data, callback) {
		console.log("Attempting to extract date from ID3 tags...");
		var separator = '-'
		var dateReg = /\d{4}-\d{2}-\d{2}/;

		var d = data.filename.match(dateReg);

		// if we find the date in the string, parse it
		// if not, skip (leave it to be added manually)
		if(d != null) {
			var parts = d[0].split(separator)
			var year = parts[0];
			var month = parts[1];
			var day = parts[2];

			data.sermonDate = new Object();
			data.sermonDate.year = year;
			data.sermonDate.month = month;
			data.sermonDate.day = day;
		}

		callback(null, data);
	},


	processTags: function(data, callback) {
		console.log("Processing ID3 tags");

		if( data.tags.subtitle ) {
			// split subtitle tag into seperate passages
			var arr = data.tags.subtitle.split(";");
			data.tags.subtitle = arr.map(function(s) { return s.trim() });
		}

		callback(null, data);
	},


	sendSNS: function(data, callback) {
		var sns = new AWS.SNS();

		sns.publish({
			TargetArn: PUBLISH_ARN,
			Message: JSON.stringify(data),
			Subject: "Sermon uploaded"
		}, function(err, data) {
			if(err) {
				console.log("SNS message failed to send");
				console.error(err);
				callback(err);
			} else {
				console.log("SNS message sent");
				callback(null, data);
			}
		});
	}
};
