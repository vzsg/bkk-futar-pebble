var UI = require('ui'),
    ajax = require('ajax'),
    Settings = require('settings');

var appTitle = 'PebFUTÁR';

var localization = {
    'en': {
        'error_generic_comm': 'Communication error!',
        'msg_location': 'Acquiring location…',
        'msg_stop_search': 'Searching for nearby stops…',
        'title_favorite_stops': 'Favorite stops',
        'title_nearby_stops': 'Nearby stops',
        'msg_no_stops_nearby': 'No stops found nearby.',
        'msg_no_departures': 'No departures found from this stop.',
        'msg_no_stops': 'No stops found for this trip.',
        'msg_trip_loading_format': 'Loading stops for {trip}…',
        'msg_departure_loading_format': 'Loading departures for {stop}…',
        'title_tools': 'Tools',
        'btn_favorite': 'Favorite',
        'btn_unfavorite': 'Unfavorite',
        'btn_refresh': 'Refresh',
        'btn_info': 'Trip info'
    },
    
    'hu': {
        'error_generic_comm': 'Kommunikációs hiba!',
        'msg_location': 'Helymeghatározás…',
        'msg_stop_search': 'Megállók keresése…',
        'title_favorite_stops': 'Kedvenc megállók',
        'title_nearby_stops': 'Megállók a közelben',
        'msg_no_stops_nearby': 'Nincs megálló a közelben.',
        'msg_no_departures': 'Nem indulnak járatok ebből a megállóból.',
        'msg_no_stops': 'Nincs megálló a kért járathoz.',
        'msg_trip_loading_format': 'Megállók keresése a {trip} járathoz…',
        'msg_departure_loading_format': 'Járatok keresése a {stop} megállóban…',
        'title_tools': 'Eszközök',
        'btn_favorite': 'Kedvenc',
        'btn_unfavorite': 'Nem kedvenc',
        'btn_refresh': 'Frissítés',
        'btn_info': 'Járatok'
    }
};


/// Utilities
function deg2rad(deg) {
    return deg * Math.PI / 180;
}

function geoDistance(sLat, sLng, eLat, eLng, accuracy) {
    accuracy = Math.floor(accuracy) || 1;
    var radius = 6378137;
    var distance = Math.round(Math.acos(Math.sin(deg2rad(eLat)) * Math.sin(deg2rad(sLat)) + Math.cos(deg2rad(eLat)) * Math.cos(deg2rad(sLat)) * Math.cos(deg2rad(sLng) - deg2rad(eLng))) * radius);
    return Math.floor(Math.round(distance/accuracy)*accuracy);
}

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
    var svc = this,
        locationOptions = {
        'timeout': 15000,
        'maximumAge': 30000,
        'enableHighAccuracy': true
    };
    
    console.log('SRV: Acquiring location...');
    svc.position = null;
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            console.log('SRV: Location: ' + pos.coords.latitude + ', ' +  pos.coords.longitude);
            svc.position = pos.coords;
            callback({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        },
        function (err) {
            console.warn('SRV: Location error (' + err.code + '): ' + err.message);
            callback({error: err.message});
        },
        locationOptions);
};

FutarService.prototype.getStopsForLocation = function (lat, lon, radius, callback) {   
    var svc = this,
        stopUrl = this.apiBaseUrl + 'stops-for-location.json' +
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
            var item = {
                title: title,
                subtitle: stopName,
                stop: {
                    id: dataItem.id,
                    name: stopName,
                    routes: matchingRoutes,
                    distance: svc.position !== null ? geoDistance(svc.position.latitude, svc.position.longitude, dataItem.lat, dataItem.lon, svc.position.accuracy) : 0
                }
            };

            console.log('SRV: Stop "' + stopName + '" => ' + title + " (" + item.stop.distance + "m)");
            stops.push(item);
        }
        
        stops.sort(function (s1, s2) {
            return s1.stop.distance - s2.stop.distance;
        });

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

FutarService.prototype.getFavorites = function() {
    if (!this.favoriteStops) {
        var setting = Settings.option('favorite_stops') || null;
        this.favoriteStops = (JSON.parse(setting) || []).filter(function (i) { return typeof i === 'object'; });
    }

    return this.favoriteStops;
};


FutarService.prototype.isFavorite = function(stop) {
    var favorites = this.getFavorites();
    return favorites.some(function (s) {
        return s.stop.id === stop.stop.id;                    
    });
};

FutarService.prototype.setFavorite = function(stop, fav) {
    var favorites = this.getFavorites(),
        isFav = this.isFavorite(stop);
    
    if (!isFav && fav) {
        favorites.push(stop);
        this.favoriteStops = favorites;
        Settings.option('favorite_stops', JSON.stringify(favorites));
    } else if (isFav && !fav) {
        this.favoriteStops = favorites.filter(function (s) { return s.stop.id !== stop.stop.id; });
        Settings.option('favorite_stops', JSON.stringify(this.favoriteStops));
    }
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

    this.stopMenu.on('select', this.handleStopSelect.bind(this));
    this.stopMenu.on('longSelect', this.showDetailsForStop.bind(this));
    this.departureMenu.on('select', this.handleTripSelect.bind(this));
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
    this.updateFavorites();

    this.stopMenu.section(2, {
        title: loc('title_tools'),
        items: [ { title: loc('btn_refresh'), icon: 'images/action_refresh.png' }]
    });

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
    var favorite = this.service.isFavorite(selectEvent.item);

    var toolsSection = {
            title: loc('title_tools'),
            items: [{
                title: favorite ? loc('btn_unfavorite') : loc('btn_favorite'),
                icon: favorite ? 'images/action_unfav.png' : 'images/action_fav.png'
            }, {
                title: loc('btn_info'),
                icon: 'images/action_info.png'
            },
            {
                title: loc('btn_refresh'),
                icon: 'images/action_refresh.png'
            }]};

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

                controller.departureMenu.section(1, toolsSection);

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

FutarController.prototype.handleStopSelect = function(selectEvent) {
    switch (selectEvent.sectionIndex) {
    case 0:
    case 1:
        this.showDeparturesForStop(selectEvent);
        break;
    case 2:
        this.refreshStops();
        break;
    }
};
FutarController.prototype.handleTripSelect = function(selectEvent) {
    if (selectEvent.sectionIndex === 0) {
        this.showTripDetails(selectEvent);
    } else if (selectEvent.sectionIndex === 1) {
        switch (selectEvent.itemIndex) {
        case 0:                            
            this.toggleFavoriteStop(this.currentStopEvent);
            break;
        case 1:
            this.showDetailsForStop(this.currentStopEvent);
            break;
        case 2:
            this.refreshDepartures();
            break;
        }
        
    }
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


FutarController.prototype.toggleFavoriteStop = function(stopEvent) {
    var stop = stopEvent.item;
    var newFavorite = !this.service.isFavorite(stop);
    console.log('CTRL: setting favorite state of ' + stop.stop.id + ' to: ' + newFavorite);
    this.service.setFavorite(stop, newFavorite);
    this.departureMenu.item(1, 0, {
        title: newFavorite ? loc('btn_unfavorite') : loc('btn_favorite'),
        icon: newFavorite ? 'images/action_unfav.png' : 'images/action_fav.png'
    });

    this.updateFavorites();
};

FutarController.prototype.updateFavorites = function() {
    var favorites = this.service.getFavorites();
    console.log(JSON.stringify(favorites));
    this.stopMenu.section(1, { title: loc('title_favorite_stops'), items: favorites.length ? favorites : [] });
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