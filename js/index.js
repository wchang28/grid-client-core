"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require("events");
var rcf = require("rcf");
var utils_1 = require("./utils");
var eventStreamPathname = '/services/events/event_stream';
var clientOptions = { reconnetIntervalMS: 10000 };
var MessageClient = (function () {
    function MessageClient(__msgClient) {
        this.__msgClient = __msgClient;
    }
    MessageClient.prototype.subscribe = function (destination, cb, headers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var sub_id = _this.__msgClient.subscribe(destination, function (msg) {
                var gMsg = msg.body;
                cb(gMsg, msg.headers);
            }, headers, function (err) {
                if (err)
                    reject(err);
                else
                    resolve(sub_id);
            });
        });
    };
    MessageClient.prototype.unsubscribe = function (sub_id) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.__msgClient.unsubscribe(sub_id, function (err) {
                if (err)
                    reject(err);
                else
                    resolve({});
            });
        });
    };
    MessageClient.prototype.send = function (destination, headers, msg) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.__msgClient.send(destination, headers, msg, function (err) {
                if (err)
                    reject(err);
                else
                    resolve({});
            });
        });
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
        var _this = _super.call(this) || this;
        _this.__authApi = new rcf.AuthorizedRestApi($drver, access, tokenGrant);
        _this.__authApi.on('on_access_refreshed', function (newAccess) {
            _this.emit('on_access_refreshed', newAccess);
        });
        return _this;
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
    ApiCore.prototype.$J = function (method, pathname, data) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.__authApi.$JP(method, pathname, data)
                .then(function (result) {
                resolve(result.ret);
            }).catch(function (err) {
                reject(err);
            });
        });
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
        var _this = _super.call(this, $drver, access, tokenGrant) || this;
        _this.__jobSubmit = __jobSubmit;
        return _this;
    }
    JobSubmmit.prototype.submit = function () {
        return this.$J('POST', '/services/job/submit', this.__jobSubmit);
    };
    return JobSubmmit;
}(ApiCore));
// job re-submission class
var JobReSubmmit = (function (_super) {
    __extends(JobReSubmmit, _super);
    function JobReSubmmit($drver, access, tokenGrant, __oldJobId, __failedTasksOnly) {
        var _this = _super.call(this, $drver, access, tokenGrant) || this;
        _this.__oldJobId = __oldJobId;
        _this.__failedTasksOnly = __failedTasksOnly;
        return _this;
    }
    JobReSubmmit.prototype.submit = function () {
        var path = utils_1.Utils.getJobOpPath(this.__oldJobId, 're_submit');
        var data = {
            failedTasksOnly: (this.__failedTasksOnly ? '1' : '0')
        };
        return this.$J('GET', path, data);
    };
    return JobReSubmmit;
}(ApiCore));
;
// will emit the follwoing events:
// 1. submitted (jobId)
// 2. status-changed (jobProgress: IJobProgress)
// 3. done (jobProgress: IJobProgress)
// 4. task-complete (task:ITask)
// 4. error
var GridJob = (function (_super) {
    __extends(GridJob, _super);
    function GridJob($drver, access, tokenGrant, __js) {
        var _this = _super.call(this, $drver, access, tokenGrant) || this;
        _this.__js = __js;
        _this.__jobId = null;
        return _this;
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
        this.__js.submit() // submit the job
            .then(function (jobProgress) {
            // job submit successful
            _this.__jobId = jobProgress.jobId;
            _this.emit('submitted', _this.__jobId);
            if (_this.onJobProgress(null, jobProgress)) {
                // job still running
                var msgClient_1 = _this.$M(); // create a message client
                msgClient_1.on('connect', function (conn_id) {
                    // connected, try to subscribe to the job topic
                    msgClient_1.subscribe(utils_1.Utils.getJobNotificationTopic(_this.jobId), function (gMsg) {
                        if (gMsg.type === 'status-changed') {
                            var jobProgress_1 = gMsg.content;
                            _this.onJobProgress(msgClient_1, jobProgress_1);
                        }
                        else if (gMsg.type === 'task-complete') {
                            var task = gMsg.content;
                            _this.emit('task-complete', task);
                        }
                    }, {})
                        .then(function (sub_id) {
                        // job topic subscription successful, try to get the job progress again
                        var path = utils_1.Utils.getJobOpPath(_this.jobId, 'progress');
                        _this.$J("GET", path, {})
                            .then(function (jobProgress) {
                            _this.onJobProgress(msgClient_1, jobProgress);
                        }).catch(function (err) {
                            _this.onError(msgClient_1, err);
                        });
                    }).catch(function (err) {
                        // job topic subscription failed
                        _this.onError(msgClient_1, err);
                    });
                }).on('error', function (err) {
                    // message client error
                    _this.onError(msgClient_1, err);
                });
            }
        }).catch(function (err) {
            // job submit failed
            _this.onError(null, err);
        });
    };
    Object.defineProperty(GridJob.prototype, "jobId", {
        get: function () { return this.__jobId; },
        enumerable: true,
        configurable: true
    });
    return GridJob;
}(ApiCore));
var AutoScalableGrid = (function () {
    function AutoScalableGrid(api) {
        this.api = api;
    }
    AutoScalableGrid.prototype.getWorkers = function (workerIds) { return this.api.$J("GET", "/services/scalable/get_workers", workerIds); };
    AutoScalableGrid.prototype.disableWorkers = function (workerIds) { return this.api.$J("POST", "/services/scalable/disable_workers", workerIds); };
    AutoScalableGrid.prototype.setWorkersTerminating = function (workerIds) { return this.api.$J("POST", "/services/scalable/set_workers_terminating", workerIds); };
    AutoScalableGrid.prototype.getCurrentState = function () { return this.api.$J("GET", "/services/scalable/state", {}); };
    return AutoScalableGrid;
}());
var GridAutoScaler = (function () {
    function GridAutoScaler(api) {
        this.api = api;
    }
    GridAutoScaler.prototype.isScalingUp = function () { return this.api.$J("GET", "/services/autoscaler/is_scaling_up", {}); };
    GridAutoScaler.prototype.launchNewWorkers = function (launchRequest) { return this.api.$J("POST", "/services/autoscaler/launch_new_workers", launchRequest); };
    GridAutoScaler.prototype.terminateWorkers = function (workers) { return this.api.$J("POST", "/services/autoscaler/terminate_workers", workers); };
    GridAutoScaler.prototype.isEnabled = function () { return this.api.$J("GET", "/services/autoscaler/is_enabled", {}); };
    GridAutoScaler.prototype.enable = function () { return this.api.$J("POST", "/services/autoscaler/enable", {}); };
    GridAutoScaler.prototype.disable = function () { return this.api.$J("POST", "/services/autoscaler/disable", {}); };
    GridAutoScaler.prototype.hasMaxWorkersCap = function () { return this.api.$J("GET", "/services/autoscaler/has_max_workers_cap", {}); };
    GridAutoScaler.prototype.hasMinWorkersCap = function () { return this.api.$J("GET", "/services/autoscaler/has_min_workers_cap", {}); };
    GridAutoScaler.prototype.getMaxWorkersCap = function () { return this.api.$J("GET", "/services/autoscaler/get_max_workers_cap", {}); };
    GridAutoScaler.prototype.setMaxWorkersCap = function (value) { return this.api.$J("POST", "/services/autoscaler/set_max_workers_cap", value); };
    GridAutoScaler.prototype.getMinWorkersCap = function () { return this.api.$J("GET", "/services/autoscaler/get_min_workers_cap", {}); };
    GridAutoScaler.prototype.setMinWorkersCap = function (value) { return this.api.$J("POST", "/services/autoscaler/set_min_workers_cap", value); };
    GridAutoScaler.prototype.getTerminateWorkerAfterMinutesIdle = function () { return this.api.$J("GET", "/services/autoscaler/get_terminate_worker_after_minutes_idle", {}); };
    GridAutoScaler.prototype.setTerminateWorkerAfterMinutesIdle = function (value) { return this.api.$J("POST", "/services/autoscaler/set_terminate_worker_after_minutes_idle", value); };
    GridAutoScaler.prototype.getRampUpSpeedRatio = function () { return this.api.$J("GET", "/services/autoscaler/get_ramp_up_speed_ratio", {}); };
    GridAutoScaler.prototype.setRampUpSpeedRatio = function (value) { return this.api.$J("POST", "/services/autoscaler/set_ramp_up_speed_ratio", value); };
    GridAutoScaler.prototype.getLaunchingWorkers = function () { return this.api.$J("GET", "/services/autoscaler/get_launching_workers", {}); };
    GridAutoScaler.prototype.getJSON = function () { return this.api.$J("GET", "/services/autoscaler", {}); };
    GridAutoScaler.prototype.getImplementationConfigUrl = function () { return this.api.$J("GET", "/services/autoscaler/get_impl_config_url", {}); };
    return GridAutoScaler;
}());
var SessionBase = (function (_super) {
    __extends(SessionBase, _super);
    function SessionBase($drver, access, tokenGrant) {
        return _super.call(this, $drver, access, tokenGrant) || this;
    }
    SessionBase.prototype.createMsgClient = function () {
        return this.$M();
    };
    Object.defineProperty(SessionBase.prototype, "AutoScalableGrid", {
        get: function () { return new AutoScalableGrid(this); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SessionBase.prototype, "GridAutoScaler", {
        get: function () { return new GridAutoScaler(this); },
        enumerable: true,
        configurable: true
    });
    SessionBase.prototype.getTimes = function () { return this.$J("GET", '/services/times', {}); };
    SessionBase.prototype.autoScalerAvailable = function () { return this.$J("GET", '/services/autoscaler_available', {}); };
    SessionBase.prototype.runJob = function (jobSubmit) {
        var js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    };
    SessionBase.prototype.sumbitJob = function (jobSubmit) {
        var js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return js.submit();
    };
    SessionBase.prototype.reRunJob = function (oldJobId, failedTasksOnly) {
        var js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    };
    SessionBase.prototype.reSumbitJob = function (oldJobId, failedTasksOnly) {
        var js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return js.submit();
    };
    SessionBase.prototype.getMostRecentJobs = function () { return this.$J("GET", '/services/job/most_recent', {}); };
    SessionBase.prototype.killJob = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'kill');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobProgress = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'progress');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobInfo = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'info');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobResult = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'result');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getDispatcherJSON = function () { return this.$J("GET", '/services/dispatcher', {}); };
    SessionBase.prototype.setDispatchingEnabled = function (enabled) {
        var path = "/services/dispatcher/dispatching/" + (enabled ? "start" : "stop");
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.setQueueOpened = function (open) {
        var path = "/services/dispatcher/queue/" + (open ? "open" : "close");
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getConnections = function () { return this.$J("GET", '/services/connections', {}); };
    SessionBase.prototype.setNodeEnabled = function (nodeId, enabled) {
        var path = utils_1.Utils.getNodePath(nodeId, (enabled ? "enable" : "disable"));
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getTaskResult = function (jobId, taskIndex) {
        var path = utils_1.Utils.getTaskOpPath(jobId, taskIndex);
        return this.$J("GET", path, {});
    };
    return SessionBase;
}(ApiCore));
exports.SessionBase = SessionBase;
var utils_2 = require("./utils");
exports.Utils = utils_2.Utils;
