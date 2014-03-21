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

        var pluginName = 'geotracepicker',
            config = JSON.parse( configStr ),
            defaultZoom = 15,
            tile = config.tile || {
                "dynamic": {
                    "source": 'http://{s}.tiles.mapbox.com/v3/undp.map-6grwd0n3/{z}/{x}/{y}.png',
                    "attribution": 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
                },
                "static": {
                    "source": 'http://api.tiles.mapbox.com/v3/undp.map-6grwd0n3/{lon},{lat},{z}/{width}x{height}.png',
                    "attribution": 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
                }
            },
            placeMarkerIcon = L.divIcon( {
                iconSize: 16,
                className: 'enketo-geopoint-circle-marker'
            } ),
            placeMarkerIconActive = L.divIcon( {
                iconSize: 16,
                className: 'enketo-geopoint-circle-marker-active'
            } )
            /*,
            EnketoCircleMarker = L.CircleMarker.extend( {
                options: {
                    index: null
                }
            } )*/
            ;

        /**
         * Geotrace widget Class
         * @constructor
         * @param {Element} element [description]
         * @param {(boolean|{touch: boolean, repeat: boolean})} options options
         * @param {*=} e     event
         */

        function Geotracepicker( element, options ) {
            var that = this;
            this.namespace = pluginName;
            // call the super class constructor
            Widget.call( this, element, options );

            this._init();
        }

        // copy the prototype functions from the Widget super class
        Geotracepicker.prototype = Object.create( Widget.prototype );

        // ensure the constructor is the new one
        Geotracepicker.prototype.constructor = Geotracepicker;

        /**
         * Initializes the picker
         */
        Geotracepicker.prototype._init = function() {
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

            console.log( 'points', this.points );

            this.$widget.find( 'input:not([name="search"])' ).on( 'change change.bymap change.bysearch', function( event ) {
                var changed,
                    lat = that.$lat.val() ? Number( that.$lat.val() ) : "",
                    lng = that.$lng.val() ? Number( that.$lng.val() ) : "",
                    // we need to avoid a missing alt in case acc is not empty!
                    alt = that.$alt.val() ? Number( that.$alt.val() ) : "",
                    acc = that.$acc.val() ? Number( that.$acc.val() ) : "";

                event.stopImmediatePropagation();

                that._editPoint( [ lat, lng, alt, acc ] );
                changed = that._updateValue();

                if ( changed ) {
                    that._updateMap();
                }

                if ( event.namespace !== 'bysearch' && that.$search ) {
                    that.$search.val( '' );
                }
            } );

            this.$points.on( 'click', '.point', function() {
                that._setCurrent( that.$points.find( '.point' ).index( $( this ) ) );
                return false;
            } );

            this.$points.find( '.addpoint' ).on( 'click', function() {
                that._addPointBtn( that.points.length + 1 );
                that.points.push( [] );
                that._setCurrent( that.points.length - 1 );
                that._updateValue();
                return false;
            } );

            this.$widget.find( '.btn-remove' ).on( 'click', function() {
                if ( that.points.length < 2 ) {
                    that._updateInputs( [] );
                } else if ( window.confirm( 'This will delete the current geopoint and cannot be undone. Are you sure?' ) ) {
                    that._removePoint();
                }
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
                this.$points.find( '.addpoint' ).click();
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
            }
        };

        Geotracepicker.prototype._getProps = function() {
            var props = {};

            props.search = !this.options.touch;
            props.detect = !! navigator.geolocation;
            props.map = this.options.touch !== true || ( this.options.touch === true && $( this.element ).closest( '.or-appearance-maps' ).length > 0 );
            props.updateMapFn = ( props.map ) ? ( ( this.options.touch ) ? "_updateStaticMap" : "_updateDynamicMap" ) : null;

            return props;
        };

        Geotracepicker.prototype._addPointBtn = function( label ) {
            this.$points.find( '.addpoint' ).before( '<a href="#" class="point btn btn-default">' + label + '</a>' );
        };

        /**
         * Adds the DOM elements
         */
        Geotracepicker.prototype._addDomElements = function() {
            var detect =
                '<button name="geodetect" type="button" class="btn btn-default" title="detect current location" data-placement="top">' +
                '<i class="glyphicon glyphicon-screenshot"> </i></button>',
                search =
                    '<div class="input-group">' +
                    '<input class="geo ignore form-control" name="search" type="text" placeholder="search for place or address" disabled="disabled"/>' +
                    '<span class="input-group-btn"><button class="btn btn-default"><i class="glyphicon glyphicon-search"> </i></button></span>' +
                    '</div>',
                map = '<div  class="map-canvas-wrapper"><div class=map-canvas id="map' + this.mapId + '"></div>';

            this.$widget = $(
                '<div class="geopicker widget">' +
                '<div class="points btn-group"><a href="#" class="addpoint btn btn-primary">+</a></div>' +
                '<div class="search-bar no-search-input no-map"></div>' +
                '<div class="geo-inputs">' +
                '<label class="geo">latitude (x.y &deg;)<input class="ignore" name="lat" type="number" step="0.0001" min="-90" max="90"/></label>' +
                '<label class="geo">longitude (x.y &deg;)<input class="ignore" name="long" type="number" step="0.0001" min="-180" max="180"/></label>' +
                '<label class="geo">altitude (m)<input class="ignore" name="alt" type="number" step="0.1" /></label>' +
                '<label class="geo">accuracy (m)<input class="ignore" name="acc" type="number" step="0.1" /></label>' +
                '<button class="btn-remove"><span class="glyphicon glyphicon-trash"> </span></button>' +
                '</div>' +
                '</div>'
            );

            // if geodetection is supported, add the button
            if ( this.props.detect ) {
                this.$widget.find( '.search-bar' ).append( detect );
                this.$detect = this.$widget.find( 'button[name="geodetect"]' );
            }
            // if not on a mobile device, add the search field
            if ( this.props.search ) {
                this.$widget.find( '.search-bar' ).removeClass( 'no-search-input' ).append( search );
                this.$search = this.$widget.find( '[name="search"]' );
            }
            // if not on a mobile device or specifically requested, add the map canvas
            if ( this.props.map ) {
                this.$widget.find( '.search-bar' ).removeClass( 'no-map' ).after( map );
                this.$map = this.$widget.find( '.map-canvas' );
            }

            this.$lat = this.$widget.find( '[name="lat"]' );
            this.$lng = this.$widget.find( '[name="long"]' );
            this.$alt = this.$widget.find( '[name="alt"]' );
            this.$acc = this.$widget.find( '[name="acc"]' );
            this.$points = this.$widget.find( '.points' );

            $( this.element ).hide().after( this.$widget ).parent().addClass( 'clearfix' );
        };

        /**
         * Updates the value in the original input element.
         *
         * @return {boolean} Whether the value was changed.
         */
        Geotracepicker.prototype._updateValue = function() {
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
         * Though this deviates from other widgets, it seems better to immediately validate a single point here
         * in addition to what happens in the FormModel.
         *
         * @param  {string}  geopoint [description]
         * @return {Boolean}          [description]
         */
        Geotracepicker.prototype._isValidGeopoint = function( geopoint ) {
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

        Geotracepicker.prototype._isValidLatLngList = function( latLngs ) {
            var that = this;

            return latLngs.every( function( latLng, index, array ) {
                return that._isValidLatLng( latLng ) || ( index === array.length - 1 );
            } );
        };

        Geotracepicker.prototype._isValidLatLng = function( latLng ) {
            console.log( 'checking validity of latLng', latLng );
            var lat, lng;

            lat = ( typeof latLng[ 0 ] === 'number' ) ? latLng[ 0 ] : ( typeof latLng.lat === 'number' ) ? latLng.lat : null;
            lng = ( typeof latLng[ 1 ] === 'number' ) ? latLng[ 1 ] : ( typeof latLng.lng === 'number' ) ? latLng.lng : null;

            return ( lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 );
        };

        Geotracepicker.prototype._markAsInvalid = function( index ) {
            this.$points.find( '.point' ).eq( index ).addClass( 'has-error' );
        };

        Geotracepicker.prototype._markAsValid = function() {
            this.$points.find( '.point' ).removeClass( 'has-error' );
        };

        Geotracepicker.prototype._setCurrent = function( index ) {
            this.currentIndex = index;
            this.$points.find( '.point' ).removeClass( 'active' ).eq( index ).addClass( 'active' );
            this._updateInputs( this.points[ index ], '' );
            // make sure that the current marker is marked as active
            this._updateMarkers();
            console.log( 'set current index to ', this.currentIndex );
        };

        /**
         * Enables geo detection using the built-in browser geoLocation functionality
         */
        Geotracepicker.prototype._enableDetection = function() {
            var that = this;
            this.$detect.click( function( event ) {
                event.preventDefault();
                navigator.geolocation.getCurrentPosition( function( position ) {
                    //that.points[that.currentIndex] = [ position.coords.latitude, position.coords.longitude ];
                    //that._updateMap( );
                    that._updateInputs( [ position.coords.latitude, position.coords.longitude, position.coords.altitude, position.coords.accuracy ] );
                    // if current index is last of points, automatically create next point
                    if ( that.currentIndex === that.points.length - 1 ) {
                        that.$points.find( '.addpoint' ).click();
                    }
                } );
                return false;
            } );
        };

        /**
         * Enables search functionality using the Google Maps API v3
         */
        Geotracepicker.prototype._enableSearch = function() {
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
         * Empties all inputs, sets map to 0,0, clears value in original input
         */
        Geotracepicker.prototype._reset = function() {

        };

        /**
         * Whether google maps are available (whether scripts have loaded).
         */
        Geotracepicker.prototype._dynamicMapAvailable = function() {
            return !!this.map;
        };

        /**
         * Calls the appropriate map update function.
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number=} zoom zoom level
         */
        Geotracepicker.prototype._updateMap = function( latLng, zoom ) {
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

            return this[ this.props.updateMapFn ]( latLng, zoom );
        };

        /**
         * Loads a static map with placemarker. Does not use Google Maps v3 API (uses Static Maps API instead)
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number} zoom zoom level
         */
        Geotracepicker.prototype._updateStaticMap = function( latLng, zoom ) {
            var lat, lng, width, height;

            if ( !this.props.map ) {
                return;
            }

            lat = latLng[ 0 ] || latLng.lat || 0;
            lng = latLng[ 1 ] || latLng.lng || 0;
            width = Math.round( this.$map.width() );
            height = Math.round( this.$map.height() );

            this.$map.empty().append(
                '<img src="' + tile[ "static" ][ "source" ].replace( '{lat}', lat ).replace( '{lon}', lng ).replace( '{z}', defaultZoom ).replace( '{width}', width ).replace( '{height}', height ) + '"/>' +
                '<div class="attribution">' + tile[ "static" ][ "attribution" ] + '</div>'
            );
        };

        /**
         * Updates the dynamic (Maps API v3) map to either show the provided coordinates (in the center), with the provided zoom level
         * or to update any markers, polylines
         *
         * @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number} zoom zoom
         */
        Geotracepicker.prototype._updateDynamicMap = function( latLng, zoom ) {
            var that = this;

            if ( !this.map ) {
                console.log( 'no map yet, creating it' );
                this.map = L.map( 'map' + this.mapId )
                    .on( 'click', function( e ) {
                        // do nothing if the field has a current marker
                        // instead the user will have to drag
                        if ( !that.$lat.val() || !that.$lng.val() ) {
                            // that._points[that.currentIndex] = e.latLng;
                            that._updateInputs( e.latlng, 'change.bymap' );
                            that._updateMap();
                            // if current index is last of points, automatically create next point
                            if ( that.currentIndex === that.points.length - 1 ) {
                                that.$points.find( '.addpoint' ).click();
                            }
                        }
                    } );

                L.tileLayer( tile[ "dynamic" ][ "source" ], {
                    attribution: tile[ "dynamic" ][ "attribution" ],
                    maxZoom: 18
                } ).addTo( this.map );

                // watch out, default "Leaflet" link clicks away from page, loosing all data
                this.map.attributionControl.setPrefix( '' );
            }

            if ( !latLng ) {
                this._updatePolyline();
                this._updateMarkers();
            } else {
                this.map.setView( latLng, zoom );
            }

        };

        Geotracepicker.prototype._updateMarkers = function() {
            var coords = [],
                markers = [],
                that = this;

            console.log( 'updateing markers', this.points );

            if ( this.points.length < 2 && this.points[ 0 ].join() === '' ) {
                this.markers = null;
                return;
            }

            if ( this.markerLayer ) {
                this.markerLayer.clearLayers();
            }

            this.points.forEach( function( latLng, index ) {
                var icon = ( index === that.currentIndex ) ? placeMarkerIconActive : placeMarkerIcon;
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
                // this is important when no polyline can be drawn (because a point is invalid)
                //var bounds = new L.LatLngBounds( this.points );
                this.map.fitBounds( coords );
            }

            console.log( 'redrawn all markers' );
        };

        Geotracepicker.prototype._updatePolyline = function() {
            var polylinePoints;
            console.log( 'updating polyline' );
            if ( this.points.length < 2 || !this._isValidLatLngList( this.points ) ) {
                // to prevent quirky line remainder when all points are deleted, redraw first
                if ( this.polyline && this.map ) {
                    this.map.removeLayer( this.polyline );
                }
                this.polyline = null;
                console.log( 'list of points invalid' );
                return;
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
         * Moves the existing marker to the provided coordinates or places a new one in the center of the map
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         */
        Geotracepicker.prototype._placeMarker = function( latLng ) {
            var that = this;

            /*if ( !this._dynamicMapAvailable() ) {
                return;
            }

            latLng = latLng || this.map.getCenter();

            if ( !this.marker ) {
                this.marker = L.marker( latLng, {
                    icon: placeMarkerIcon,
                    draggable: true
                } ).addTo( this.map )
                    .on( 'dragend', function( event ) {
                        var latLng = event.target.getLatLng();
                        that._updateInputs( latLng, 'change.bymap' );
                        that._updateMap( latLng );
                    } );
            } else {
                this.marker.setLatLng( latLng );
            }
*/
            //CENTRALIZE???
        };

        Geotracepicker.prototype._editPoint = function( latLng ) {
            var oldVal = this.points[ this.currentIndex ].join();
            this.points[ this.currentIndex ] = latLng;
            // this comparison is not completely accurate
            // e.g. [50,1] should be equal to {lat: 50, lng: 1}
            return oldVal !== latLng.join();
        };

        /**
         * removes current point
         */
        Geotracepicker.prototype._removePoint = function() {
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

        /**
         * Updates the (fake) input element for latitude, longitude, altitude and accuracy
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number, alt: number, acc: number}} coords latitude, longitude, altitude and accuracy
         * @param  {string=} ev  [description]
         */
        Geotracepicker.prototype._updateInputs = function( coords, ev ) {
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

        Geotracepicker.prototype.disable = function() {
            this.$map.hide();
            this.$widget.find( '.btn' ).addClass( 'disabled' );
        };

        Geotracepicker.prototype.enable = function() {
            this.$map.show();
            this.$widget.find( '.btn' ).removeClass( 'disabled' );
        };


        $.fn[ pluginName ] = function( options, event ) {

            return this.each( function() {
                var $this = $( this ),
                    data = $( this ).data( pluginName );

                options = options || {};

                if ( !data && typeof options === 'object' ) {
                    $this.data( pluginName, ( data = new Geotracepicker( this, options, event ) ) );
                } else if ( data && typeof options == 'string' ) {
                    //pass the context, used for destroy() as this method is called on a cloned widget
                    data[ options ]( this );
                }
            } );
        };

    } );
