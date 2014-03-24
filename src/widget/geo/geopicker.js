/**
 * @preserve Copyright 2012 Martijn van de Rijdt & Modi Labs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

define( [ 'jquery', 'enketo-js/Widget', 'text!enketo-config', 'leaflet' ],
    function( $, Widget, configStr, L ) {
        "use strict";

        var pluginName = 'geopicker',
            config = JSON.parse( configStr ),
            defaultView = [ 39.7334, -104.9926 ],
            defaultZoom = 15,
            tile = config.tile || {
                "source": 'http://{s}.tiles.mapbox.com/v3/undp.map-6grwd0n3/{z}/{x}/{y}.png',
                "attribution": 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
            },
            iconSingle = L.divIcon( {
                iconSize: 24,
                className: 'enketo-geopoint-marker'
            } ),
            iconMulti = L.divIcon( {
                iconSize: 16,
                className: 'enketo-geopoint-circle-marker'
            } ),
            iconMultiActive = L.divIcon( {
                iconSize: 16,
                className: 'enketo-geopoint-circle-marker-active'
            } );

        /**
         * Geotrace widget Class
         * @constructor
         * @param {Element} element [description]
         * @param {(boolean|{touch: boolean, repeat: boolean})} options options
         * @param {*=} e     event
         */

        function Geopicker( element, options ) {
            var that = this;
            this.namespace = pluginName;
            // call the super class constructor
            Widget.call( this, element, options );

            this._init();
        }

        // copy the prototype functions from the Widget super class
        Geopicker.prototype = Object.create( Widget.prototype );

        // ensure the constructor is the new one
        Geopicker.prototype.constructor = Geopicker;

        /**
         * Initializes the picker
         */
        Geopicker.prototype._init = function() {
            var loadedVal = $( this.element ).val().trim(),
                that = this,
                defaultLatLng = [ 16.8164, -3.0171 ];

            this.mapId = Math.round( Math.random() * 10000000 );
            this.props = this._getProps();

            this._addDomElements();
            this.currentIndex = 0;
            this.points = [];
            // load default value
            if ( loadedVal ) {
                $( this.element ).val().trim().split( ';' ).forEach( function( el, i ) {
                    console.log( 'adding loaded point', el.trim().split( ' ' ) );
                    that.points[ i ] = el.trim().split( ' ' );
                    that.points[ i ].forEach( function( str, i, arr ) {
                        arr[ i ] = Number( str );
                    } );
                } );
            }
            console.log( 'props', this.props );
            console.log( 'points', this.points );

            this.$widget.find( 'input:not([name="search"])' ).on( 'change change.bymap change.bysearch', function( event ) {
                var lat = that.$lat.val() ? Number( that.$lat.val() ) : "",
                    lng = that.$lng.val() ? Number( that.$lng.val() ) : "",
                    // we need to avoid a missing alt in case acc is not empty!
                    alt = that.$alt.val() ? Number( that.$alt.val() ) : "",
                    acc = that.$acc.val() ? Number( that.$acc.val() ) : "";

                event.stopImmediatePropagation();

                that._editPoint( [ lat, lng, alt, acc ] );

                if ( event.namespace !== 'bysearch' && that.$search ) {
                    that.$search.val( '' );
                }
            } );

            this.$points.on( 'click', '.point', function() {
                that._setCurrent( that.$points.find( '.point' ).index( $( this ) ) );
                return false;
            } );

            this.$points.find( '.addpoint' ).on( 'click', function() {
                that._addPoint();
                return false;
            } ).end().find( '.close-chain' ).on( 'click', function() {
                that._closePolygon();
                return false;
            } );

            this.$widget.find( '.btn-remove' ).on( 'click', function() {
                if ( that.points.length < 2 ) {
                    that._updateInputs( [] );
                } else if ( window.confirm( 'This will completely remove the current geopoint from the list of geopoints and cannot be undone. Are you sure you want to do this?' ) ) {
                    that._removePoint();
                }
            } );

            this.$map.find( '.show-map-btn' ).on( 'click', function() {
                that.$widget.find( '.search-bar' ).removeClass( 'hide-search' );
                that.$widget.addClass( 'full-screen' );
                that._updateMap();
                return false;
            } );

            this.$widget.find( '.hide-map-btn' ).on( 'click', function() {
                that.$widget.find( '.search-bar' ).addClass( 'hide-search' );
                that.$widget.removeClass( 'full-screen' ).find( '.map-canvas' ).removeClass( 'leaflet-container' );
                if ( that.map ) {
                    that.map.remove();
                    that.map = null;
                    that.polygon = null;
                    that.polyline = null;
                }
                return false;
            } );

            this.$widget.on( 'focus blur', 'input', function( event ) {
                $( that.element ).trigger( event.type );
            } );

            // enable search
            if ( this.props.search ) {
                this._enableSearch();
            }

            // enable detection
            if ( this.props.detect ) {
                this._enableDetection();
            }

            // creating "point buttons"
            if ( loadedVal ) {
                this.points.forEach( function( el, i ) {
                    that._addPointBtn( i + 1 );
                } );
            } else {
                this._addPoint();
            }

            // setting map location on load
            if ( !loadedVal && this.props.detect ) {
                console.log( 'tracepicker detecting current' );
                navigator.geolocation.getCurrentPosition( function( position ) {
                    console.log( 'tracepicker found it', position );
                    that._updateMap( [ position.coords.latitude, position.coords.longitude ] );
                } );
            } else if ( !loadedVal ) {
                this._updateMap( defaultLatLng );
            } else {
                this._updateMap();
                this._setCurrent( this.currentIndex );
            }
        };

        /**
         * Gets the widget properties and features.
         *
         * @return {{search: boolean, detect: boolean, map: boolean, updateMapFn: string, type: string}} The widget properties object
         */
        Geopicker.prototype._getProps = function() {
            var map = this.options.touch !== true || ( this.options.touch === true && $( this.element ).closest( '.or-appearance-maps' ).length > 0 );
            return {
                detect: !! navigator.geolocation,
                map: map,
                search: map,
                //updateMapFn: map ? ( this.options.touch ? "_updateStaticMap" : "_updateDynamicMap" ) : null,
                type: this.element.attributes[ 'data-type-xml' ].textContent,
                touch: this.options.touch
            };
        };

        /**
         * Adds a point button in the point navigation bar
         * @param {string} label The label to show on the button.
         */
        Geopicker.prototype._addPointBtn = function( label ) {
            this.$points.find( '.addpoint' ).before( '<a href="#" class="point btn btn-default">' + label + '</a>' );
        };

        /**
         * Adds the DOM elements
         */
        Geopicker.prototype._addDomElements = function() {
            var map = '<div class="map-canvas-wrapper"><div class=map-canvas id="map' + this.mapId + '"></div></div>',
                points = '<div class="points btn-group"><button class="addpoint btn btn-default"><span class="glyphicon glyphicon-plus"> </span></button></div>',
                close = '<button class="close-chain btn btn-success"><span class="glyphicon glyphicon-link"> </span></button>',
                mapBtn = '<a href="#" class="show-map-btn btn btn-default">Map</a>';

            this.$widget = $(
                '<div class="geopicker widget">' +
                '<div class="search-bar hide-search no-map no-detect">' +
                '<a href="#" class="hide-map-btn btn btn-default"><span class="glyphicon glyphicon-arrow-left"> </span></a>' +
                '<button name="geodetect" type="button" class="btn btn-default" title="detect current location" data-placement="top">' +
                '<span class="glyphicon glyphicon-screenshot"> </span></button>' +
                '<div class="input-group">' +
                '<input class="geo ignore" name="search" type="text" placeholder="search for place or address" disabled="disabled"/>' +
                '<span class="input-group-btn"><button class="btn btn-default"><i class="glyphicon glyphicon-search"> </i></button></span>' +
                '</div>' +
                '</div>' +
                '<div class="geo-inputs">' +
                '<label class="geo">latitude (x.y &deg;)<input class="ignore" name="lat" type="number" step="0.0001" min="-90" max="90"/></label>' +
                '<label class="geo">longitude (x.y &deg;)<input class="ignore" name="long" type="number" step="0.0001" min="-180" max="180"/></label>' +
                '<label class="geo">altitude (m)<input class="ignore" name="alt" type="number" step="0.1" /></label>' +
                '<label class="geo">accuracy (m)<input class="ignore" name="acc" type="number" step="0.1" /></label>' +
                '<button class="btn-remove"><span class="glyphicon glyphicon-trash"> </span></button>' +
                '</div>' +
                '</div>'
            );

            // add the detection button
            if ( this.props.detect ) {
                this.$widget.find( '.search-bar' ).removeClass( 'no-detect' );
                this.$detect = this.$widget.find( 'button[name="geodetect"]' );
            }

            this.$search = this.$widget.find( '[name="search"]' );

            // add the map canvas
            if ( this.props.map ) {
                this.$widget.find( '.search-bar' ).removeClass( 'no-map' ).after( map );
                this.$map = this.$widget.find( '.map-canvas' );
            } else {
                this.$map = $();
            }

            // touchscreen maps
            if ( this.props.touch && this.props.map ) {
                this.$map.append( mapBtn );
            }

            if ( !this.props.touch ) {
                this.$widget.find( '.search-bar' ).removeClass( 'hide-search' );
            }

            // if points bar is required
            if ( this.props.type !== 'geopoint' ) {
                this.$points = $( points );
                if ( this.props.type === 'geoshape' ) {
                    this.$points.append( close );
                }
                this.$widget.prepend( this.$points );
            } else {
                this.$points = $();
            }

            this.$lat = this.$widget.find( '[name="lat"]' );
            this.$lng = this.$widget.find( '[name="long"]' );
            this.$alt = this.$widget.find( '[name="alt"]' );
            this.$acc = this.$widget.find( '[name="acc"]' );


            $( this.element ).hide().after( this.$widget ).parent().addClass( 'clearfix' );
        };

        /**
         * Updates the value in the original input element.
         *
         * @return {Boolean} Whether the value was changed.
         */
        Geopicker.prototype._updateValue = function() {
            var oldGeoTraceValue = $( this.element ).val(),
                newGeoTraceValue = '',
                that = this;

            this._markAsValid();

            // all points should be valid geopoints and only the last item may be empty
            this.points.forEach( function( point, index, array ) {
                var geopoint,
                    lat = typeof point[ 0 ] === 'number' ? point[ 0 ] : ( typeof point.lat === 'number' ? point.lat : null ),
                    lng = typeof point[ 1 ] === 'number' ? point[ 1 ] : ( typeof point.lng === 'number' ? point.lng : null ),
                    alt = typeof point[ 2 ] === 'number' ? point[ 2 ] : 0.0,
                    acc = typeof point[ 3 ] === 'number' ? point[ 3 ] : 0.0;

                geopoint = ( lat && lng ) ? lat + ' ' + lng + ' ' + alt + ' ' + acc : "";

                //only last item may be empty
                if ( !that._isValidGeopoint( geopoint ) && !( geopoint === '' && index === array.length - 1 ) ) {
                    that._markAsInvalid( index );
                }
                //newGeoTraceValue += geopoint;
                if ( !( geopoint === '' && index === array.length - 1 ) ) {
                    newGeoTraceValue += geopoint;
                    if ( index !== array.length - 1 ) {
                        newGeoTraceValue += ';';
                    }
                } else {
                    // remove trailing semi-colon
                    newGeoTraceValue = newGeoTraceValue.substring( 0, newGeoTraceValue.lastIndexOf( ';' ) );
                }
            } );

            console.log( 'updating value by joining', this.points, 'old value', oldGeoTraceValue, 'new value', newGeoTraceValue );

            if ( oldGeoTraceValue !== newGeoTraceValue ) {
                $( this.element ).val( newGeoTraceValue ).trigger( 'change' );
                return true;
            } else {
                return false;
            }
        };

        /**
         * Checks an Openrosa geopoint for validity. This function is used to provide more detailed
         * error feedback than provided by the form controller. This can be used to pinpoint the exact
         * invalid geopoints in a list of geopoint (the form controller only validates the total list).
         *
         * @param  {string}  geopoint [description]
         * @return {Boolean}          [description]
         */
        Geopicker.prototype._isValidGeopoint = function( geopoint ) {
            var coords;

            if ( !geopoint ) {
                return false;
            }

            coords = geopoint.toString().split( ' ' );
            return (
                ( coords[ 0 ] !== '' && coords[ 0 ] >= -90 && coords[ 0 ] <= 90 ) &&
                ( coords[ 1 ] !== '' && coords[ 1 ] >= -180 && coords[ 1 ] <= 180 ) &&
                ( typeof coords[ 2 ] == 'undefined' || !isNaN( coords[ 2 ] ) ) &&
                ( typeof coords[ 3 ] == 'undefined' || ( !isNaN( coords[ 3 ] ) && coords[ 3 ] >= 0 ) )
            );
        };

        /**
         * Validates a list of latLng Arrays or Objects
         * @param  {Array.((Array.<number|string>|{lat: number, long:number}))}  latLngs Array of latLng objects or arrays
         * @return {Boolean}         Whether list is valid or not
         */
        Geopicker.prototype._isValidLatLngList = function( latLngs ) {
            var that = this;

            return latLngs.every( function( latLng, index, array ) {
                return that._isValidLatLng( latLng ) || ( latLng.join() === '' && index === array.length - 1 );
            } );
        };

        /**
         * Validates an individual latlng Array or Object
         * @param  {(Array.<number|string>|{lat: number, long:number})}  latLng latLng object or array
         * @return {Boolean}        Whether latLng is valid or not
         */
        Geopicker.prototype._isValidLatLng = function( latLng ) {
            console.log( 'checking validity of latLng', latLng );
            var lat, lng;

            lat = ( typeof latLng[ 0 ] === 'number' ) ? latLng[ 0 ] : ( typeof latLng.lat === 'number' ) ? latLng.lat : null;
            lng = ( typeof latLng[ 1 ] === 'number' ) ? latLng[ 1 ] : ( typeof latLng.lng === 'number' ) ? latLng.lng : null;

            return ( lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 );
        };

        /**
         * Marks a point as invalid in the points navigation bar
         * @param  {number} index Index of point
         */
        Geopicker.prototype._markAsInvalid = function( index ) {
            this.$points.find( '.point' ).eq( index ).addClass( 'has-error' );
        };

        /**
         * Marks all points as valid in the points navigation bar
         */
        Geopicker.prototype._markAsValid = function() {
            this.$points.find( '.point' ).removeClass( 'has-error' );
        };

        /**
         * Changes the current point in the list of points
         */
        Geopicker.prototype._setCurrent = function( index ) {
            this.currentIndex = index;
            this.$points.find( '.point' ).removeClass( 'active' ).eq( index ).addClass( 'active' );
            this._updateInputs( this.points[ index ], '' );
            // make sure that the current marker is marked as active
            if ( !this.props.touch || this._inFullScreenMode() ) {
                this._updateMarkers();
            }
            console.log( 'set current index to ', this.currentIndex );
        };

        /**
         * Enables geo detection using the built-in browser geoLocation functionality
         */
        Geopicker.prototype._enableDetection = function() {
            var that = this;
            this.$detect.click( function( event ) {
                event.preventDefault();
                navigator.geolocation.getCurrentPosition( function( position ) {
                    //that.points[that.currentIndex] = [ position.coords.latitude, position.coords.longitude ];
                    //that._updateMap( );
                    that._updateInputs( [ position.coords.latitude, position.coords.longitude, position.coords.altitude, position.coords.accuracy ] );
                    // if current index is last of points, automatically create next point
                    if ( that.currentIndex === that.points.length - 1 && that.props.type !== 'geopoint' ) {
                        that._addPoint();
                    }
                } );
                return false;
            } );
        };

        /**
         * Enables search functionality using the Google Maps API v3
         */
        Geopicker.prototype._enableSearch = function() {
            var that = this;

            this.$search
                .prop( 'disabled', false )
                .on( 'change', function( event ) {
                    var address = $( this ).val();
                    event.stopImmediatePropagation();

                    if ( address ) {
                        $.get( "http://nominatim.openstreetmap.org/search/" + address + "?format=json", function( response ) {
                            var location = response[ 0 ] || null;
                            if ( location && location.lat && location.lon ) {
                                console.log( 'showing search result on map' );
                                //that._placeMarker( [ location.lat, location.lon ] );
                                that._updateMap( [ location.lat, location.lon ], defaultZoom );
                                //that._updateInputs( [ location.lat, location.lon ], 'change.bysearch' );
                                that.$search.closest( '.input-group' ).removeClass( 'has-error' );
                            } else {
                                //TODO: add error message
                                that.$search.closest( '.input-group' ).addClass( 'has-error' );
                                console.log( "Location '" + address + "' not found" );
                            }
                        }, 'json' )
                            .fail( function() {
                                //TODO: add error message
                                that.$search.closest( '.input-group' ).addClass( 'has-error' );
                                console.log( "Error. Geocoding service may not be available or app is offline" );
                            } )
                            .always( function() {

                            } );
                    } else {

                    }
                } );
        };

        /**
         * Determines whether map is available for manipulation.
         */
        Geopicker.prototype._dynamicMapAvailable = function() {
            return !!this.map;
        };

        Geopicker.prototype._inFullScreenMode = function() {
            return this.$widget.hasClass( 'full-screen' );
        };

        /**
         * Calls the appropriate map update function.
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number=} zoom zoom level
         * @return {Function} Returns call to function
         */
        Geopicker.prototype._updateMap = function( latLng, zoom ) {
            console.log( 'trace update map', 'latLng', latLng, 'zoom', zoom, 'points', this.points );
            if ( !this.props.map ) {
                return;
            }

            if ( !zoom ) {
                if ( this.map ) {
                    // note: there are conditions where getZoom returns undefined!
                    zoom = this.map.getZoom() || defaultZoom;
                } else {
                    zoom = defaultZoom;
                }
            }

            // serves to remember last requested map coordinates to initiate map in mobile view
            this.lastLatLng = latLng || this.lastLatLng || defaultView;
            console.log( 'stored lastLatLng', this.lastLatLng );

            if ( !this.props.touch || this._inFullScreenMode() ) {
                this._updateDynamicMap( latLng, zoom );
            }
        };



        /**
         * Loads a static map. (No markers due to difficult of determining zoom level that would show all of them)
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number} zoom zoom level
         */
        /*Geopicker.prototype._updateStaticMap = function( latLng, zoom ) {
            var lat, lng, width, height,
                markers = '';

            if ( !this.props.map ) {
                return;
            }

            latLng = latLng || this.points[ 0 ] || defaultLatLng;

            lat = latLng[ 0 ] || latLng.lat || 0;
            lng = latLng[ 1 ] || latLng.lng || 0;
            width = Math.round( this.$map.width() );
            height = Math.round( this.$map.height() );

            this.$map.addClass( 'static' ).empty().append(
                '<img src="' + tile[ "static" ][ "source" ].replace( '{markers}/', '' ).replace( '{lat}', lat ).replace( '{lon}', lng ).replace( '{z}', defaultZoom ).replace( '{width}', width ).replace( '{height}', height ) + '"/>' +
                '<div class="attribution">' + tile[ "static" ][ "attribution" ] + '</div>'
            );
        };*/

        /**
         * Updates the dynamic map to either show the provided coordinates (in the center), with the provided zoom level
         * or updates any markers, polylines, polygons
         *
         * @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number} zoom zoom
         */
        Geopicker.prototype._updateDynamicMap = function( latLng, zoom ) {
            var that = this;

            console.log( 'dynamic map to be updated with latLng', latLng );
            if ( !this.map ) {
                console.log( 'no map yet, creating it' );
                this.map = L.map( 'map' + this.mapId )
                    .on( 'click', function( e ) {
                        console.log( 'clicked on map', e.latlng );
                        // do nothing if the field has a current marker
                        // instead the user will have to drag
                        if ( !that.$lat.val() || !that.$lng.val() || that.props.type === 'geopoint' ) {
                            // that._points[that.currentIndex] = e.latLng;
                            that._updateInputs( e.latlng, 'change.bymap' );
                            //console.log( 'going to call update map' );
                            //that._updateMap();
                            // if current index is last of points, automatically create next point
                            // except if type = geopoint
                            if ( that.currentIndex === that.points.length - 1 && that.props.type !== 'geopoint' ) {
                                that._addPoint();
                            }
                        }
                    } );

                L.tileLayer( tile[ "source" ], {
                    attribution: tile[ "attribution" ],
                    maxZoom: 18
                } ).addTo( this.map );

                // watch out, default "Leaflet" link clicks away from page, loosing all data
                this.map.attributionControl.setPrefix( '' );
            }

            if ( !latLng ) {
                this._updatePolyline();
                this._updateMarkers();
                if ( this.points.length === 1 && this.points[ 0 ].toString() === '' ) {
                    this.map.setView( this.lastLatLng, zoom );
                }
            } else {
                console.log( 'setting map view with center', latLng );
                this.map.setView( latLng, zoom );
            }
        };

        /**
         * Updates the markers on the dynamic map from the current list of points.
         */
        Geopicker.prototype._updateMarkers = function() {
            var coords = [],
                markers = [],
                that = this;

            console.log( 'updateing markers', this.points );

            if ( this.markerLayer ) {
                this.markerLayer.clearLayers();
            }

            if ( this.points.length < 2 && this.points[ 0 ].join() === '' ) {
                return;
            }

            this.points.forEach( function( latLng, index ) {
                var icon = that.props.type === 'geopoint' ? iconSingle : ( index === that.currentIndex ? iconMultiActive : iconMulti );
                if ( that._isValidLatLng( latLng ) ) {
                    coords.push( latLng );
                    markers.push( L.marker( latLng, {
                        icon: icon,
                        clickable: true,
                        draggable: true,
                        alt: index,
                        opacity: 0.9
                    } ).on( 'click', function( e ) {
                        console.log( 'clicked marker', e );
                        that._setCurrent( e.target.options.alt );
                    } ).on( 'dragend', function( e ) {
                        var latLng = e.target.getLatLng();
                        // first set the current index the point dragged
                        that._setCurrent( e.target.options.alt );
                        that._updateInputs( latLng, 'change.bymap' );
                        that._updateMap();
                    } ) );
                } else {
                    console.log( 'this latLng was not considered valid', latLng );
                }
            } );

            console.log( 'markers to update', markers );

            if ( markers.length > 0 ) {
                this.markerLayer = L.layerGroup( markers ).addTo( this.map );
                // change the view to fit all the markers
                // don't use this for multiple markers, it messed up map clicks to place points
                if ( this.points.length === 1 ) {
                    this.map.fitBounds( coords );
                }
            }

            console.log( 'redrawn all markers' );
        };

        /**
         * Updates the polyline on the dynamic map from the current list of points
         */
        Geopicker.prototype._updatePolyline = function() {
            var polylinePoints;

            if ( this.props.type === 'geopoint' ) {
                return;
            }

            console.log( 'updating polyline' );
            if ( this.points.length < 2 || !this._isValidLatLngList( this.points ) ) {
                // remove quirky line remainder
                if ( this.map ) {
                    if ( this.polyline ) {
                        this.map.removeLayer( this.polyline );
                    }
                    if ( this.polygon ) {
                        this.map.removeLayer( this.polygon );
                    }
                }
                this.polyline = null;
                this.polygon = null;
                console.log( 'list of points invalid' );
                return;
            }

            // polyline and polygon are mutually exclusive
            if ( this._isPolygon( this.points ) ) {
                console.log( 'detected that this polyline is a polygon' );
                if ( this.polyline ) {
                    if ( this.map ) {
                        this.map.removeLayer( this.polyline );
                    }
                    this.polyline = null;
                }
                this._updatePolygon();
                return;
            } else if ( this.polygon ) {
                if ( this.map ) {
                    this.map.removeLayer( this.polygon );
                }
                this.polygon = null;
            }

            polylinePoints = ( this.points[ this.points.length - 1 ].join( '' ) !== '' ) ? this.points : this.points.slice( 0, this.points.length - 1 );

            if ( !this.polyline ) {
                this.polyline = L.polyline( polylinePoints, {
                    color: 'red'
                } ).addTo( this.map );
            } else {
                this.polyline.setLatLngs( polylinePoints );
            }
            this.map.fitBounds( this.polyline.getBounds() );
            console.log( 'done updating polyline' );
        };


        /**
         * Updates the polygon on the dynamic map from the current list of points.
         * A polygon is a type of polyline. This function is ALWAYS called by _updatePolyline.
         */
        Geopicker.prototype._updatePolygon = function() {

            if ( this.props.type === 'geopoint' ) {
                return;
            }

            console.log( 'updating polygon' );

            if ( !this.polygon ) {
                console.log( 'creating new polygon' );
                this.polygon = L.polygon( this.points, {
                    color: 'red'
                } ).addTo( this.map );
            } else {
                console.log( 'updating existing polygon', this.polygon );
                this.polygon.setLatLngs( this.points );
            }
            this.map.fitBounds( this.polygon.getBounds() );
            console.log( 'done updating polygon' );
        };

        Geopicker.prototype._isPolygon = function( latLngs ) {
            // no need to check for validaty of latLngs. This already happened in _updatePolyline.
            return this.props.type === 'geoshape' && latLngs.length >= 4 && JSON.stringify( latLngs[ 0 ] ) === JSON.stringify( latLngs[ latLngs.length - 1 ] );
        };


        Geopicker.prototype._addPoint = function() {
            this._addPointBtn( this.points.length + 1 );
            this.points.push( [] );
            this._setCurrent( this.points.length - 1 );
            this._updateValue();
        };

        /**
         * Edits a point in the list of points
         * @param  {Array.<number>|{lat: number, lng: number, alt: number, acc: number}} latLng LatLng object or array
         * @return {Boolean]}        Whether point changed.
         */
        Geopicker.prototype._editPoint = function( latLng ) {
            var changed,
                oldVal = this.points[ this.currentIndex ];
            this.points[ this.currentIndex ] = latLng;
            // this comparison is not completely accurate
            // e.g. [50,1] should be equal to {lat: 50, lng: 1}
            // but this should not cause errors
            //return JSON.stringify( oldVal ) !== JSON.stringify( latLng );

            changed = this._updateValue();

            if ( changed ) {
                this._updateMap();
            }
            return changed;
        };

        /**
         * Removes the current point
         */
        Geopicker.prototype._removePoint = function() {
            var newIndex = this.currentIndex;
            this.points.splice( this.currentIndex, 1 );
            this._updateValue();
            this.$points.find( '.point' ).eq( this.currentIndex ).remove();
            if ( typeof this.points[ this.currentIndex ] === 'undefined' ) {
                newIndex = this.currentIndex - 1;
            }
            this._setCurrent( newIndex );
            // this will call updateMarkers for the second time which is not so efficient
            this._updateMap();
        };

        Geopicker.prototype._closePolygon = function() {
            var lastPoint = this.points[ this.points.length - 1 ];
            console.log( 'closing polygon' );
            // check if chain can be closed
            if ( this.points.length < 3 || ( this.points.length === 3 && !this._isValidLatLng( this.points[ 2 ] ) ) || ( JSON.stringify( this.points[ 0 ] ) === JSON.stringify( lastPoint ) ) ) {
                return;
            }

            // determine which point the make the closing point
            // if the last point is not a valid point, assume the user wants to use this to close
            // otherwise create a new point.
            if ( !this._isValidLatLng( lastPoint ) ) {
                console.log( 'current last point is not a valid point, so will use this as closing point' );
                this.currentIndex = this.points.length - 1;
            } else {
                console.log( 'current last point is valid, so will create a new one to use to close' );
                this._addPoint();
            }

            this._updateInputs( this.points[ 0 ] );
        };

        /**
         * Updates the (fake) input element for latitude, longitude, altitude and accuracy
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number, alt: number, acc: number}} coords latitude, longitude, altitude and accuracy
         * @param  {string=} ev  [description]
         */
        Geopicker.prototype._updateInputs = function( coords, ev ) {
            var lat = coords[ 0 ] || coords.lat || '',
                lng = coords[ 1 ] || coords.lng || '',
                alt = coords[ 2 ] || coords.alt || '',
                acc = coords[ 3 ] || coords.acc || '';

            ev = ( typeof ev !== 'undefined' ) ? ev : 'change';

            this.$lat.val( Math.round( lat * 10000 ) / 10000 || '' );
            this.$lng.val( Math.round( lng * 10000 ) / 10000 || '' );
            this.$alt.val( Math.round( alt * 10 ) / 10 || '' );
            this.$acc.val( Math.round( acc * 10 ) / 10 || '' ).trigger( ev );
        };

        /**
         * Disables the widget
         */
        Geopicker.prototype.disable = function() {
            this.$map.hide();
            this.$widget.find( '.btn' ).addClass( 'disabled' );
        };

        /**
         * Enables a disabled widget
         */
        Geopicker.prototype.enable = function() {
            this.$map.show();
            this.$widget.find( '.btn' ).removeClass( 'disabled' );
        };


        $.fn[ pluginName ] = function( options, event ) {

            return this.each( function() {
                var $this = $( this ),
                    data = $( this ).data( pluginName );

                options = options || {};

                if ( !data && typeof options === 'object' ) {
                    $this.data( pluginName, ( data = new Geopicker( this, options, event ) ) );
                } else if ( data && typeof options == 'string' ) {
                    //pass the context, used for destroy() as this method is called on a cloned widget
                    data[ options ]( this );
                }
            } );
        };

    } );
