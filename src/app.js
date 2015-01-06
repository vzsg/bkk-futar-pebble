var UI = require('ui'),
    ajax = require('ajax');

var appTitle = 'BKK FUTÁR';

/// Utilities
function fixAccents(str) {
    return decodeURIComponent(escape(str));    
}

/// Service class
var FutarService = function (apiBaseUrl) {
    console.log('SRV: <init>');
    this.apiBaseUrl = apiBaseUrl || 'http://futar.bkk.hu/bkk-utvonaltervezo-api/ws/otp/api/where/';
};

FutarService.prototype.acquireLocation = function (callback) {
    var locationOptions = {
        'timeout': 15000,
        'maximumAge': 30000,
        'enableHighAccuracy': true
    };
    
    console.log('SRV: Acquiring location...');
    window.navigator.geolocation.getCurrentPosition(
        function (pos) {
            console.log('SRV: Location: ' + pos.coords.latitude + ', ' +  pos.coords.longitude);
            callback({ lat: pos.coords.latitude, lon: pos.coords.longitude});
        },
        function (err) {
            console.warn('SRV: Location error (' + err.code + '): ' + err.message);
            callback({error: err.message});
        },
        locationOptions);
};

FutarService.prototype.getStopsForLocation = function (lat, lon, radius, callback) {   
    var stopUrl = this.apiBaseUrl + 'stops-for-location.json' +
        '?lat=' + lat + '&lon=' + lon +
        '&radius=' + radius;
    
    function parseStops(raw) {
        var dataObj = JSON.parse(raw),
            data = dataObj.data.stops || dataObj.data.list || [],
            stops = [],
            routes = dataObj.data.references.routes || {};
        
        function lookupRoute(id) {
            return routes[id];
        }
        
        function getRouteName(route) {
            return route.shortName || route.longName;
        }
        
        for (var i = 0; i < data.length; ++i) {
            var dataItem = data[i],
                routeIds = dataItem.routeIds || [];
            
            if (!routeIds.length) continue;

            var stopName = fixAccents(dataItem.name),
                matchingRoutes = routeIds.map(lookupRoute),
                routeNames = matchingRoutes.map(getRouteName),
                uniqueRouteNames = [];
            
            for (var j = 0; j < routeNames.length; j++) {
                if (uniqueRouteNames.indexOf(routeNames[j]) === -1) {
                    uniqueRouteNames.push(routeNames[j]);
                }
            }
            
            var title = uniqueRouteNames.join(', ');
            console.log('SRV: Stop "' + stopName + '" => ' + title);

            var item = {
                title: title,
                subtitle: stopName,
                stop: {
                    id: dataItem.id,
                    name: stopName,
                    routes: matchingRoutes
                }
            };
            
            stops.push(item);
        }
        
        console.log('SRV: Found ' + stops.length + ' stops.');
        callback({ items: stops });
    }
    
    function reportError(error) {
        if (error.message) {
            console.warn('SRV: Stops request failed: ' + error.message);
            callback({ error: error.message });
        } else {
            console.warn('SRV: Stops request failed: unknown');
            callback({ error: 'Communication error!'});
        } 
    }

    console.log('SRV: Stops request started: ' + stopUrl);
    ajax(stopUrl, parseStops, reportError);
};

FutarService.prototype.getDeparturesForStop = function(stopId, callback) {
    var adUrl = this.apiBaseUrl + 'arrivals-and-departures-for-stop/' + stopId + '.json';            

    function parseDepartures(raw) {
        var d = JSON.parse(raw), data, busTimes = [];

        if (d.data.entry) {
            data = d.data.entry.arrivalsAndDepartures;
        } else {
            data = d.data.arrivalsAndDepartures || [];
        }
        
        for (var i = 0; i < data.length; ++i) {
            var dataItem = data[i];
            var predictTime;
            
            predictTime = dataItem.predictedArrivalTime || dataItem.scheduledArrivalTime || 0;
            
            var item = {
                title: '(' + (predictTime ? (Math.ceil((predictTime - d.currentTime) / (60 * 1000)) + "'") : '?') + ') - ' + fixAccents(dataItem.routeShortName),
                subtitle: '> ' + fixAccents(dataItem.tripHeadsign),
                extras: {
                    routeId: dataItem.routeId,
                    tripId: dataItem.tripId
                }
            };
            
            busTimes.push(item);
        }
        
        console.log('SRV: Found ' + busTimes.length + ' departures.');
        callback({items: busTimes});
    }
    
    function reportError(error) {
        if (error.message) {
            console.warn('SRV: Departures request failed: ' + error.message);
            callback({ error: error.message });
        } else {
            console.warn('SRV: Departures request failed: unknown');
            callback({ error: 'Communication error!'});
        } 
    }
    
    console.log('SRV: Departures request started: ' + adUrl);
    ajax(adUrl, parseDepartures, reportError);
};

/// Controller
function FutarController(service) {
    console.log('CTRL: <init>');
    this.service = service;
    this.stopMenu = new UI.Menu();
    this.departureMenu = new UI.Menu();
    this.statusCard = new UI.Card({ title: appTitle });
    this.stopDetailCard = new UI.Card({ scrollable: true, style: 'small' });
    this.retryAction = null;

    this.stopMenu.on('select', this.showDeparturesForStop.bind(this));
    this.stopMenu.on('longSelect', this.showDetailsForStop.bind(this));
    this.stopMenu.on('accelTap', this.refreshStops.bind(this));
    this.departureMenu.on('accelTap', this.refreshDepartures.bind(this));
    this.statusCard.on('click', this.retryLastCall.bind(this));
}

FutarController.prototype.setRetryAction = function (action) {
    console.log('CTRL: New retry action: ' + action);
    this.retryAction = action;
    this.statusCard.action(action ? { select: 'images/action_refresh.png' } : {});
};

FutarController.prototype.retryLastCall = function(clickEvent) {
    if (clickEvent.button !== 'select') return;

    console.log('CTRL: Retrying: ' + this.retryAction);

    if (this.retryAction === 'stop') {
        this.refreshStops();
    } else if (this.retryAction === 'departure') {
        this.refreshDepartures();
    }
};

FutarController.prototype.refreshStops = function() {
    var controller = this;
    
    console.log('CTRL: Updating nearby stops...');

    this.statusCard.body('Acquiring location...');
    this.statusCard.show();
    this.stopMenu.hide();
    this.setRetryAction(null);
    
    this.service.acquireLocation(function (res) {
        if (res.error) {
            controller.statusCard.body(res.error);
        } else {
            controller.statusCard.body('Searching for nearby stops...');
            controller.service.getStopsForLocation(res.lat, res.lon, 200, function (stopsRes) {
                controller.setRetryAction('stop');

                if (stopsRes.error) {
                    controller.statusCard.body(stopsRes.error);
                } else {
                    if (stopsRes.items.length) {
                        controller.stopMenu.section(0, {
                            title: 'Nearby stops',
                            items: stopsRes.items
                        });

                        controller.statusCard.hide();
                        controller.stopMenu.show();
                    } else {
                        controller.statusCard.body('No stops found nearby.');
                    }

                    console.log('CTRL: Stop update complete.');
                }
            });
        }
    });
};

FutarController.prototype.showDeparturesForStop = function(selectEvent) {
    var controller = this, stopId = selectEvent.item.stop.id, stopName = selectEvent.item.stop.name;
    
    console.log('CTRL: Updating departures for stop: ' + stopId);
    this.statusCard.body('Loading departures for ' + stopName);
    this.statusCard.show();
    this.departureMenu.hide();

    this.setRetryAction(null);
    this.currentStopEvent = selectEvent;
    this.service.getDeparturesForStop(stopId, function (res) {
        controller.setRetryAction('departure');

        if (res.error) {
            controller.statusCard.body(res.error);
        } else {
            if (res.items.length) {
                controller.departureMenu.section(0, {
                    title: stopName,
                    items: res.items
                });

                controller.statusCard.hide();
                controller.departureMenu.show();
            } else {
                controller.statusCard.body('No departures found.');
            }

            console.log('CTRL: Departure update complete.');
        }
    });
};

FutarController.prototype.refreshDepartures = function() {
    if (this.currentStopEvent) {
        console.log('CTRL: Refreshing departures after shake...');
        this.showDeparturesForStop(this.currentStopEvent);
    }
};

FutarController.prototype.showDetailsForStop = function(selectEvent) {
    var i, route, body = "\n";
                       
    console.log('CTRL: Showing details for stop ' + selectEvent.item.stop.name);
    for (i = 0; i < selectEvent.item.stop.routes.length; i++) {
        route = selectEvent.item.stop.routes[i];
        if (!route) continue;

        body += fixAccents(route.shortName || route.longName) + ' (' + route.type + ')\n';
        body += fixAccents(route.description) + '\n\n';
    }

    this.stopDetailCard.title(selectEvent.item.stop.name);
    this.stopDetailCard.body(body);
    this.stopDetailCard.show();
};

/// Application
function FutarApplication() {
    console.log('APP: <init>');
    var service = new FutarService();
    this.controller = new FutarController(service);
}

FutarApplication.prototype.start = function() {
    console.log('APP: starting...');
    this.controller.refreshStops();
};

var app = new FutarApplication();
app.start();