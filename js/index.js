"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require('events');
var rcf = require('rcf');
var utils_1 = require('./utils');
var eventStreamPathname = '/services/events/event_stream';
var clientOptions = { reconnetIntervalMS: 10000 };
var MessageClient = (function () {
    function MessageClient(__msgClient) {
        this.__msgClient = __msgClient;
    }
    MessageClient.prototype.subscribe = function (destination, cb, headers, done) {
        return this.__msgClient.subscribe(destination, function (msg) {
            var gMsg = msg.body;
            cb(gMsg);
        }, headers, done);
    };
    MessageClient.prototype.unsubscribe = function (sub_id, done) { this.__msgClient.unsubscribe(sub_id, done); };
    MessageClient.prototype.send = function (destination, headers, msg, done) {
        this.__msgClient.send(destination, headers, msg, done);
    };
    MessageClient.prototype.disconnect = function () { this.__msgClient.disconnect(); };
    MessageClient.prototype.on = function (event, listener) {
        this.__msgClient.on(event, listener);
        return this;
    };
    return MessageClient;
}());
var ApiCore = (function (_super) {
    __extends(ApiCore, _super);
    function ApiCore($drver, access, tokenGrant) {
        var _this = this;
        _super.call(this);
        this.__authApi = new rcf.AuthorizedRestApi($drver, access, tokenGrant);
        this.__authApi.on('on_access_refreshed', function (newAccess) {
            _this.emit('on_access_refreshed', newAccess);
        });
    }
    Object.defineProperty(ApiCore.prototype, "$driver", {
        get: function () { return this.__authApi.$driver; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ApiCore.prototype, "access", {
        get: function () { return this.__authApi.access; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ApiCore.prototype, "tokenGrant", {
        get: function () { return this.__authApi.tokenGrant; },
        enumerable: true,
        configurable: true
    });
    ApiCore.prototype.$J = function (method, pathname, data, done) {
        this.__authApi.$J(method, pathname, data, done);
    };
    ApiCore.prototype.$M = function () {
        return new MessageClient(this.__authApi.$M(eventStreamPathname, clientOptions));
    };
    return ApiCore;
}(events.EventEmitter));
exports.ApiCore = ApiCore;
// job submission class
var JobSubmmit = (function (_super) {
    __extends(JobSubmmit, _super);
    function JobSubmmit($drver, access, tokenGrant, __jobSubmit) {
        _super.call(this, $drver, access, tokenGrant);
        this.__jobSubmit = __jobSubmit;
    }
    JobSubmmit.prototype.submit = function (done) {
        this.$J('POST', '/services/job/submit', this.__jobSubmit, function (err, ret) {
            done(err, (err ? null : ret));
        });
    };
    return JobSubmmit;
}(ApiCore));
// job re-submission class
var JobReSubmmit = (function (_super) {
    __extends(JobReSubmmit, _super);
    function JobReSubmmit($drver, access, tokenGrant, __oldJobId, __failedTasksOnly) {
        _super.call(this, $drver, access, tokenGrant);
        this.__oldJobId = __oldJobId;
        this.__failedTasksOnly = __failedTasksOnly;
    }
    JobReSubmmit.prototype.submit = function (done) {
        var path = utils_1.Utils.getJobOpPath(this.__oldJobId, 're_submit');
        var data = {
            failedTasksOnly: (this.__failedTasksOnly ? '1' : '0')
        };
        this.$J('GET', path, data, function (err, ret) {
            done(err, (err ? null : ret));
        });
    };
    return JobReSubmmit;
}(ApiCore));
;
// will emit the follwoing events:
// 1. submitted (jobId)
// 2. status-changed (jobProgress)
// 3. done (jobProgress)
// 4. error
var GridJob = (function (_super) {
    __extends(GridJob, _super);
    function GridJob($drver, access, tokenGrant, __js) {
        _super.call(this, $drver, access, tokenGrant);
        this.__js = __js;
        this.__jobId = null;
    }
    GridJob.jobDone = function (jobProgress) {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    };
    GridJob.prototype.onError = function (msgClient, err) {
        this.emit('error', err);
        if (msgClient)
            msgClient.disconnect();
    };
    // returns true if job is still running, false otherwise
    GridJob.prototype.onJobProgress = function (msgClient, jp) {
        this.emit('status-changed', jp);
        if (utils_1.Utils.jobDone(jp)) {
            if (msgClient)
                msgClient.disconnect();
            this.emit('done', jp);
            return false;
        }
        else
            return true;
    };
    GridJob.prototype.run = function () {
        var _this = this;
        // submit the job
        this.__js.submit(function (err, jobProgress) {
            if (err) {
                _this.onError(null, err);
            }
            else {
                _this.__jobId = jobProgress.jobId;
                _this.emit('submitted', _this.__jobId);
                if (_this.onJobProgress(null, jobProgress)) {
                    var msgClient_1 = _this.$M();
                    msgClient_1.on('connect', function (conn_id) {
                        msgClient_1.subscribe(utils_1.Utils.getJobNotificationTopic(_this.jobId), function (gMsg) {
                            if (gMsg.type === 'status-changed') {
                                var jobProgress_1 = gMsg.content;
                                _this.onJobProgress(msgClient_1, jobProgress_1);
                            }
                        }, {}, function (err) {
                            if (err) {
                                _this.onError(msgClient_1, err);
                            }
                            else {
                                var path = utils_1.Utils.getJobOpPath(_this.jobId, 'progress');
                                _this.$J("GET", path, {}, function (err, jobProgress) {
                                    _this.onJobProgress(msgClient_1, jobProgress);
                                });
                            }
                        });
                    });
                    msgClient_1.on('error', function (err) {
                        _this.onError(msgClient_1, err);
                    });
                }
            }
        });
    };
    Object.defineProperty(GridJob.prototype, "jobId", {
        get: function () { return this.__jobId; },
        enumerable: true,
        configurable: true
    });
    return GridJob;
}(ApiCore));
var SessionBase = (function (_super) {
    __extends(SessionBase, _super);
    function SessionBase($drver, access, tokenGrant) {
        _super.call(this, $drver, access, tokenGrant);
    }
    SessionBase.prototype.createMsgClient = function () {
        return this.$M();
    };
    SessionBase.prototype.runJob = function (jobSubmit) {
        var js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    };
    SessionBase.prototype.sumbitJob = function (jobSubmit, done) {
        var js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        js.submit(done);
    };
    SessionBase.prototype.reRunJob = function (oldJobId, failedTasksOnly) {
        var js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    };
    SessionBase.prototype.reSumbitJob = function (oldJobId, failedTasksOnly, done) {
        var js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        js.submit(done);
    };
    SessionBase.prototype.getMostRecentJobs = function (done) {
        this.$J("GET", '/services/job/most_recent', {}, done);
    };
    SessionBase.prototype.killJob = function (jobId, done) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'kill');
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.getJobProgress = function (jobId, done) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'progress');
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.getJobInfo = function (jobId, done) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'info');
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.getJobResult = function (jobId, done) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'result');
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.getDispatcherJSON = function (done) {
        this.$J("GET", '/services/dispatcher', {}, done);
    };
    SessionBase.prototype.setDispatchingEnabled = function (enabled, done) {
        var path = "/services/dispatcher/dispatching/" + (enabled ? "start" : "stop");
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.setQueueOpened = function (open, done) {
        var path = "/services/dispatcher/queue/" + (open ? "open" : "close");
        this.$J("GET", path, {}, done);
    };
    SessionBase.prototype.getConnections = function (done) {
        this.$J("GET", '/services/connections', {}, done);
    };
    SessionBase.prototype.setNodeEnabled = function (nodeId, enabled, done) {
        var path = utils_1.Utils.getNodePath(nodeId, (enabled ? "enable" : "disable"));
        this.$J("GET", path, {}, done);
    };
    return SessionBase;
}(ApiCore));
exports.SessionBase = SessionBase;
var utils_2 = require('./utils');
exports.Utils = utils_2.Utils;
