"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// utility functions
var Utils = /** @class */ (function () {
    function Utils() {
    }
    Utils.jobDone = function (jobProgress) {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    };
    Utils.getDispatcherTopic = function () { return '/topic/dispatcher'; };
    Utils.getJobsTrackingTopic = function () { return '/topic/jobs-tracking'; };
    Utils.getConnectionsTopic = function () { return '/topic/connections'; };
    Utils.getJobNotificationTopic = function (jobId) { return '/topic/job/' + jobId; };
    Utils.getAutoScalerTopic = function () { return '/topic/autoscaler'; };
    Utils.getAutoScalerImplementationTopic = function () { return '/topic/autoscaler/implementation'; };
    Utils.getJobOpPath = function (jobId, op) { return '/services/job/' + jobId + '/' + op; };
    Utils.getNodePath = function (nodeId, op) { return "/services/dispatcher/node/" + nodeId + "/" + op; };
    Utils.getTaskOpPath = function (jobId, taskIndex, op) {
        return Utils.getJobOpPath(jobId, 'task') + '/' + taskIndex.toString() + '/' + (op ? op : "");
    };
    Utils.getAutoScalerImplementationApiBasePath = function () { return '/services/autoscaler/implementation'; };
    return Utils;
}());
exports.Utils = Utils;
