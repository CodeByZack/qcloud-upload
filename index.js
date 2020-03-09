var fs = require("fs");
var path = require("path");
var COS = require("cos-nodejs-sdk-v5");
var Q = require("q");
var ndir = require("ndir");
var assign = require("object-assign");
var chalk = require("chalk");
var log = console.log;
var isWin = /^win/.test(process.platform);

module.exports = function(config = {}) {
  config = assign(
    {
      AppId: "",
      SecretId: "",
      SecretKey: "",
      Bucket: "",
      Region: "",
      prefix: "",
      overWrite: false,
      Headers: false,
      src: "",
      dirPath: "",
      distDirName: "",
      clearDistDir: false,
      setHeaders: null
    },
    config
  );

  if (config.Bucket.indexOf("-") === -1) {
    config.Bucket += "-" + config.AppId;
  }

  var existFiles = 0;
  var uploadedFiles = 0;
  var uploadedFail = 0;
  var tasks = [];

  var cos = new COS({
    SecretId: config.SecretId,
    SecretKey: config.SecretKey
  });
  //获取需要上传的文件夹的路径
  var srcPath = path.resolve(path.parse(process.argv[1]).dir, config.src);

  if (!config.src) {
    log(
      chalk.yellow(
        "dirPath API 即将废弃，请升级配置信息，更多内容请访问 https://github.com/yingye/qcloud-upload"
      )
    );
    srcPath = config.dirPath;
  }

  //上传之前清除原有文件下的所有东西
  if (config.clearDistDir) {
    if (!config.prefix) {
      log(chalk.red("prefix 为空，会删掉全部内容"));
      return;
    }
    clear(config.prefix).then(
      () => {
        uploadFiles();
      },
      err => {
        throw err;
      }
    );
  }

  function uploadFiles() {
    ndir.walk(
      srcPath,
      function onDir(dirpath, files) {
        for (var i = 0, l = files.length; i < l; i++) {
          var info = files[i];
          if (info[1].isFile()) {
            if (config.src) {
              upload(info[1], info[0].substring(srcPath.length), info[0]);
            } else {
              upload(
                info[1],
                info[0].substring(info[0].indexOf(config.distDirName)),
                info[0]
              );
            }
          }
        }
      },
      function end() {
        if (tasks.length !== 0) {
          Q.allSettled(tasks).then(
            function(fulfilled) {
              log(
                "Upload to qcloud: Total:",
                chalk.green(fulfilled.length),
                "Skip:",
                chalk.gray(existFiles),
                "Upload:",
                chalk.green(uploadedFiles),
                "Failed:",
                chalk.red(uploadedFail)
              );
            },
            function(err) {
              log("Failed upload files:", err);
            }
          );
        }
      },
      function error(err, errPath) {
        log(
          chalk.red("Please you check your Dir option, and use absolute path.")
        );
        log("err: ", errPath, " error: ", err);
      }
    );
  }

  // upload files
  function upload(file, fileRelativePath, filePath) {
    var fileKey = path.join(config.prefix, fileRelativePath);
    //以‘/’为分隔符，cos会生成对应的文件夹。
    //windows下，强制替换\为/。
    if (isWin) {
      fileKey = fileKey.replace(/\\/g, "/");
    }
    var handler = function() {
      var defer = Q.defer();
      upload();

      function check(callback) {
        cos.headObject(
          {
            Bucket: config.Bucket,
            Region: config.Region,
            Key: fileKey
          },
          function(err, data) {
            if (err) {
              callback(false);
            } else {
              log("Exist " + fileKey);
              callback(200 == data.statusCode);
            }
          }
        );
      }

      function putFile() {
        let obj = assign(config.Headers || {}, {
          Bucket: config.Bucket,
          Region: config.Region,
          Key: fileKey,
          ContentLength: fs.statSync(filePath).size,
          Body: fs.createReadStream(filePath),
          onProgress(progressData) {
            // console.log(progressData)
          }
        });
        if(config.setHeaders){
          obj = config.setHeaders(obj);
        }
        cos.putObject(obj, function(err, data) {
          if (err) {
            uploadedFail++;
            log("err-putObject", err);
            defer.reject();
          } else {
            uploadedFiles++;
            log(chalk.green("Upload " + fileKey + " Success"));
            defer.resolve();
          }
        });
      }

      function upload() {
        if (!config.overWrite) {
          check(function(status) {
            if (status) {
              existFiles++;
              defer.resolve();
            } else {
              putFile();
            }
          });
        } else {
          putFile();
        }
      }
      return defer.promise;
    };

    tasks.push(handler());
  }

  function clear(prefix) {
    var defer = Q.defer();
    function deleteMulti(deleteObjects) {
      cos.deleteMultipleObject(
        {
          Bucket: config.Bucket,
          Region: config.Region,
          Objects: deleteObjects
        },
        function(err, data) {
          if (err) {
            defer.reject(err);
            return;
          }
          if (data.Error.length > 0) {
            log(data.Error);
          } else {
            log(chalk.green(`${prefix}文件夹清除成功！`));
          }
          defer.resolve();
        }
      );
    }
    //查询前缀下，所有文件
    cos.getBucket(
      {
        Bucket: config.Bucket,
        Region: config.Region,
        Prefix: prefix
      },
      function(err, data) {
        if (err) {
          defer.reject(err);
          return;
        }
        if (data.Contents.length > 0) {
          let deleteObjects = data.Contents.map(d => ({ Key: d.Key }));
          deleteMulti(deleteObjects);
        } else {
          log(chalk.yellow(`${prefix}下没有任何文件`));
          defer.resolve();
        }
      }
    );
    return defer.promise;
  }
};
