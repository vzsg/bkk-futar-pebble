var UI = require('ui'),
    ajax = require('ajax');

var appTitle = 'PEBFUTÁR';

var localization = {
    'en': {
        'error_generic_comm': 'Communication error!',
        'msg_location': 'Acquiring location…',
        'msg_stop_search': 'Searching for nearby stops…',
        'title_nearby_stops': 'Nearby stops',
        'msg_no_stops_nearby': 'No stops found nearby.',
        'msg_no_departures': 'No departures found from this stop.',
        'msg_no_stops': 'No stops found for this trip.',
        'msg_trip_loading_format': 'Loading stops for {trip}…',
        'msg_departure_loading_format': 'Loading departures for {stop}…'
    },
    
    'hu': {
        'error_generic_comm': 'Kommunikációs hiba!',
        'msg_location': 'Helymeghatározás…',
        'msg_stop_search': 'Megállók keresése…',
        'title_nearby_stops': 'Megállók a közelben',
        'msg_no_stops_nearby': 'Nincs megálló a közelben.',
        'msg_no_departures': 'Nem indulnak járatok ebből a megállóból.',
        'msg_no_stops': 'Nincs megálló a kért járathoz.',
        'msg_trip_loading_format': 'Megállók keresése a {trip} járathoz…',
        'msg_departure_loading_format': 'Járatok keresése a {stop} megállóban…'
    }
};


/// Utilities
function loc(key) {
    var dict = localization[navigator.language] || localization.en;
    return dict[key] || localization.en[key] || key;
}

function fixAccents(str) {
    return decodeURIComponent(escape(str));    
}

function digitsToString(digit) {
    return digit < 10 ? "0" + digit : String(digit);
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
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            console.log('SRV: Location: ' + pos.coords.latitude + ', ' +  pos.coords.longitude);
            callback({ lat: pos.coords.latitude, lon: pos.coords.longitude });
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
            callback({ error: loc('error_generic_comm') });
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
                title: (predictTime ? (Math.ceil((predictTime - d.currentTime) / (60 * 1000)) + "'") : '?') + ' - ' + fixAccents(dataItem.routeShortName),
                subtitle: '> ' + fixAccents(dataItem.tripHeadsign),
                extras: {
                    tripName: fixAccents(dataItem.routeShortName) + ' > ' + fixAccents(dataItem.tripHeadsign),
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
            callback({ error: loc('error_generic_comm') });
        } 
    }
    
    console.log('SRV: Departures request started: ' + adUrl);
    ajax(adUrl, parseDepartures, reportError);
};

FutarService.prototype.getTripDetails = function (tripId, callback) {
    var detailUrl = this.apiBaseUrl + 'trip-details.json' +
        '?tripId=' + tripId;
    
    function parseStops(raw) {
        var dataObj = JSON.parse(raw),
            data = dataObj.data.entry.stopTimes || [],
            stops = [],
            refStops = dataObj.data.references.stops || {};
        
        for (var i = 0; i < data.length; ++i) {
            var dataItem = data[i], stop = refStops[dataItem.stopId],
                stopName = fixAccents(stop.name),
                arrivalTime = new Date((dataItem.predictedArrivalTime || dataItem.arrivalTime || dataItem.predictedDepartureTime || dataItem.departureTime) * 1000),
                arrivalHours = digitsToString(arrivalTime.getHours()), arrivalMinutes = digitsToString(arrivalTime.getMinutes());
                
            var item = {
                title: arrivalHours + ":" + arrivalMinutes,
                subtitle: stopName,
                trip: dataItem
            };
            
            stops.push(item);
        }
        
        console.log('SRV: Found ' + stops.length + ' stops.');
        callback({ items: stops });
    }
    
    function reportError(error) {
        if (error.message) {
            console.warn('SRV: Trip details request failed: ' + error.message);
            callback({ error: error.message });
        } else {
            console.warn('SRV: Trip details request failed: unknown');
            callback({ error: loc('error_generic_comm') });
        } 
    }

    console.log('SRV: Trip details request started: ' + detailUrl);
    ajax(detailUrl, parseStops, reportError);                        
};

/// Controller
function FutarController(service) {
    console.log('CTRL: <init>');
    this.service = service;
    this.stopMenu = new UI.Menu();
    this.departureMenu = new UI.Menu();
    this.statusCard = new UI.Card({ title: appTitle });
    this.stopDetailCard = new UI.Card({ scrollable: true, style: 'small' });
    this.tripDetailsMenu = new UI.Menu();
    this.retryAction = null;

    this.stopMenu.on('select', this.showDeparturesForStop.bind(this));
    this.stopMenu.on('longSelect', this.showDetailsForStop.bind(this));
    this.stopMenu.on('accelTap', this.refreshStops.bind(this));
    this.departureMenu.on('accelTap', this.refreshDepartures.bind(this));
    this.departureMenu.on('select', this.showTripDetails.bind(this));
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

    this.statusCard.body(loc('msg_location'));
    this.statusCard.show();
    this.stopMenu.hide();
    this.setRetryAction(null);
    
    this.service.acquireLocation(function (res) {
        if (res.error) {
            controller.statusCard.body(res.error);
        } else {
            controller.statusCard.body(loc('msg_stop_search'));
            controller.service.getStopsForLocation(res.lat, res.lon, 400, function (stopsRes) {
                controller.setRetryAction('stop');

                if (stopsRes.error) {
                    controller.statusCard.body(stopsRes.error);
                } else {
                    if (stopsRes.items.length) {
                        controller.stopMenu.section(0, {
                            title: loc('title_nearby_stops'),
                            items: stopsRes.items
                        });

                        controller.statusCard.hide();
                        controller.stopMenu.show();
                    } else {
                        controller.statusCard.body(loc('msg_no_stops_nearby'));
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
    this.statusCard.body(loc('msg_departure_loading_format').replace('{stop}', stopName));
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
                controller.statusCard.body(loc('msg_no_departures'));
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

FutarController.prototype.showTripDetails = function(selectEvent) {
    var controller = this, tripId = selectEvent.item.extras.tripId, tripName = selectEvent.item.extras.tripName;
    
    console.log('CTRL: Loading trip details for: ' + tripId);
    this.statusCard.body(loc('msg_trip_loading_format').replace('{trip}', tripName));
    this.statusCard.show();
    this.tripDetailsMenu.hide();

    this.setRetryAction(null);
    this.currentDetailEvent = selectEvent;
    this.service.getTripDetails(tripId, function (res) {
        if (res.error) {
            controller.statusCard.body(res.error);
        } else {
            if (res.items.length) {
                controller.tripDetailsMenu.section(0, {
                    title: tripName,
                    items: res.items
                });

                controller.statusCard.hide();
                controller.tripDetailsMenu.show();
            } else {
                controller.statusCard.body(loc('msg_no_stops'));
            }

            console.log('CTRL: Trip details loaded.');
        }
    });    
};

/// Application
function FutarApplication() {
    console.log('APP: <init>');
    var service = new FutarService();
    this.controller = new FutarController(service);
}

FutarApplication.prototype.start = function() {
    console.log('APP: starting...');
    console.log('Phone language is ' + navigator.language);
    this.controller.refreshStops();
};

var app = new FutarApplication();
app.start();