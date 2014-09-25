'use strict';

require('../app');
var angular = require('angular');

angular.module('deckApp')
  .factory('oortService', function (searchService, settings, $q, Restangular, _, $timeout, clusterService, loadBalancerService, pond, securityGroupService, scheduler, taskTracker, $exceptionHandler, scheduledCache) {

    var applicationListEndpoint = Restangular.withConfig(function(RestangularConfigurer) {
      RestangularConfigurer.setBaseUrl(settings.oortUrl);
    });

    var oortEndpoint = Restangular.withConfig(function(RestangularConfigurer) {
      RestangularConfigurer.setBaseUrl(settings.oortUrl);

      RestangularConfigurer.addElementTransformer('applications', false, function(application) {

        function autoRefresh(scope) {
          application.onAutoRefresh = application.onAutoRefresh || angular.noop;
          if (application.autoRefreshEnabled) {
            var disposable = scheduler.subscribe(function() {
              getApplication(application.name).then(function (newApplication) {
                // compute task diff and generate notifications for a completed task
                taskTracker.handleCompletedTasks(taskTracker.getCompleted(
                  application.tasks,
                  newApplication.tasks
                ));

                deepCopyApplication(application, newApplication);
                application.onAutoRefresh();
                newApplication = null;
              });
            });
            scope.$on('$destroy', function () {
              application.disableAutoRefresh();
              disposable.dispose();
            });
          }
        }

        application.disableAutoRefresh = function disableAutoRefresh() {
          application.autoRefreshEnabled = false;
        };

        application.enableAutoRefresh = function enableAutoRefresh(scope) {
          application.autoRefreshEnabled = true;
          autoRefresh(scope);
        };

        application.getCluster = function getCluster(accountName, clusterName) {
          var matches = application.clusters.filter(function (cluster) {
            return cluster.name === clusterName && cluster.account === accountName;
          });
          return matches.length ? matches[0] : null;
        };

        if (application.fromServer) {
          application.accounts = Object.keys(application.clusters);
        }
        return application;

      });
    });

    function listApplications() {
      return applicationListEndpoint
        .all('applications')
        .withHttpConfig({cache: scheduledCache })
        .getList();
    }

    function getApplicationEndpoint(application) {
      return oortEndpoint.one('applications', application);
    }

    function deepCopyApplication(original, newApplication) {
      original.accounts = newApplication.accounts;
      original.clusters = newApplication.clusters;
      original.loadBalancers = newApplication.loadBalancers;
      original.tasks = newApplication.tasks;
      original.securityGroups = newApplication.securityGroups;
      newApplication.accounts = null;
      newApplication.clusters = null;
      newApplication.loadBalancers = null;
      newApplication.tasks = null;
      newApplication.securityGroups = null;
    }

    function getApplication(applicationName) {
      return getApplicationEndpoint(applicationName).get().then(function(application) {
        var clusterLoader = clusterService.loadClusters(application);
        var loadBalancerLoader = loadBalancerService.loadLoadBalancers(application);
        var securityGroupLoader = securityGroupService.loadSecurityGroups(application);
        var taskLoader = pond.one('applications', applicationName)
          .all('tasks')
          .getList();

        return $q.all({
          clusters: clusterLoader,
          loadBalancers: loadBalancerLoader,
          tasks: taskLoader,
          securityGroups: securityGroupLoader
        })
          .then(function(results) {
            application.clusters = results.clusters;
            application.serverGroups = _.flatten(_.pluck(results.clusters, 'serverGroups'));
            application.loadBalancers = results.loadBalancers;
            application.tasks = angular.isArray(results.tasks) ? results.tasks : [];
            loadBalancerService.normalizeLoadBalancersWithServerGroups(application);
            clusterService.normalizeServerGroupsWithLoadBalancers(application);
            securityGroupService.attachSecurityGroups(application, results.securityGroups);

            return application;
          }, function(err) {
            $exceptionHandler(err, 'Failed to load application');
          });
      });
    }

    function findAmis(applicationName) {
      return searchService.search({q: applicationName, type: 'namedImages'}).then(function(results) {
        return results.data[0].results;
      });
    }

    function listLoadBalancers() {
      return applicationListEndpoint
        .all('aws/loadBalancers')
        .withHttpConfig({cache: scheduledCache })
        .getList();
    }

    return {
      listApplications: listApplications,
      getApplication: getApplication,
      findAmis: findAmis,
      listLoadBalancers: listLoadBalancers,
      getApplicationWithoutAppendages: getApplicationEndpoint,
    };
  });
