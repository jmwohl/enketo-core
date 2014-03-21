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

        var pluginName = 'geopointpicker',
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
                iconSize: 24,
                className: 'enketo-geopoint-marker'
            } );

        /**
         * Geopoint widget Class
         * @constructor
         * @param {Element} element [description]
         * @param {(boolean|{touch: boolean, repeat: boolean})} options options
         * @param {*=} e     event
         */

        function Geopointpicker( element, options ) {
            var that = this;
            this.namespace = pluginName;
            // call the super class constructor
            Widget.call( this, element, options );

            this._init();
        }

        // copy the prototype functions from the Widget super class
        Geopointpicker.prototype = Object.create( Widget.prototype );

        // ensure the constructor is the new one
        Geopointpicker.prototype.constructor = Geopointpicker;

        /**
         * Initializes the picker
         */
        Geopointpicker.prototype._init = function() {
            var inputVals,
                that = this,
                defaultLatLng = [ 16.8164 - 3.0171 ];

            this.mapId = Math.round( Math.random() * 10000000 );
            this.props = this._getProps();
            this._addDomElements();

            // if empty inputVals = [""] so has length 1!
            inputVals = $( this.element ).val().split( ' ' );

            this.$widget.find( 'input:not([name="search"])' ).on( 'change change.bymap change.bysearch', function( event ) {
                var lat = ( that.$lat.val() !== '' ) ? that.$lat.val() : 0.0,
                    lng = ( that.$lng.val() !== '' ) ? that.$lng.val() : 0.0,
                    alt = ( that.$alt.val() !== '' ) ? that.$alt.val() : 0.0,
                    acc = that.$acc.val(),
                    value = ( lat === 0 && lng === 0 ) ? '' : lat + ' ' + lng + ' ' + alt + ' ' + acc;

                event.stopImmediatePropagation();

                $( that.element ).val( value ).trigger( 'change' );

                if ( event.namespace !== 'bymap' && event.namespace !== 'bysearch' ) {
                    that._placeMarker( [ lat, lng ] );
                    that._updateMap( [ lat, lng ] );
                }

                if ( event.namespace !== 'bysearch' && that.$search ) {
                    that.$search.val( '' );
                }
            } );

            this.$widget.on( 'focus blur', 'input', function( event ) {
                $( that.element ).trigger( event.type );
            } );

            if ( this.props.search ) {
                this._enableSearch();
            }

            if ( this.props.detect ) {
                this._enableDetection();
            }

            if ( inputVals.length < 2 && this.props.detect ) {
                navigator.geolocation.getCurrentPosition( function( position ) {
                    that._updateMap( [ position.coords.latitude, position.coords.longitude ] );
                } );
            } else if ( inputVals.length > 1 ) {
                this._updateInputs( inputVals, 'change' );
                this._updateMap( inputVals );
            } else {
                this._updateMap( defaultLatLng );
            }
        };

        Geopointpicker.prototype._getProps = function() {
            var props = {};

            props.search = !this.options.touch;
            props.detect = !! navigator.geolocation;
            props.map = this.options.touch !== true || ( this.options.touch === true && $( this.element ).closest( '.or-appearance-maps' ).length > 0 );
            props.updateMapFn = ( props.map ) ? ( ( this.options.touch ) ? "_updateStaticMap" : "_updateDynamicMap" ) : null;

            return props;
        };

        /**
         * Adds the DOM elements
         */
        Geopointpicker.prototype._addDomElements = function() {
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
                '<div class="search-bar no-search-input no-map"></div>' +
                '<div class="geo-inputs">' +
                '<label class="geo">latitude (x.y &deg;)<input class="ignore" name="lat" type="number" step="0.0001" min="-90" max="90" /></label>' +
                '<label class="geo">longitude (x.y &deg;)<input class="ignore" name="long" type="number" step="0.0001" min="-180" max="180" /></label>' +
                '<label class="geo">altitude (m)<input class="ignore" name="alt" type="number" step="0.1" /></label>' +
                '<label class="geo">accuracy (m)<input class="ignore" name="acc" type="number" step="0.1" /></label>' +
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

            $( this.element ).hide().after( this.$widget ).parent().addClass( 'clearfix' );
        };

        /**
         * Enables geo detection using the built-in browser geoLocation functionality
         */
        Geopointpicker.prototype._enableDetection = function() {
            var that = this;
            this.$detect.click( function( event ) {
                event.preventDefault();
                navigator.geolocation.getCurrentPosition( function( position ) {
                    that._updateMap( [ position.coords.latitude, position.coords.longitude ] );
                    that._updateInputs( [ position.coords.latitude, position.coords.longitude, position.coords.altitude, position.coords.accuracy ] );
                } );
                return false;
            } );
        };

        /**
         * Enables search functionality using the Google Maps API v3
         */
        Geopointpicker.prototype._enableSearch = function() {
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
                                that._placeMarker( [ location.lat, location.lon ] );
                                that._updateMap( [ location.lat, location.lon ] );
                                that._updateInputs( [ location.lat, location.lon ], 'change.bysearch' );
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
        Geopointpicker.prototype._reset = function() {

        };

        /**
         * Whether google maps are available (whether scripts have loaded).
         */
        Geopointpicker.prototype._dynamicMapAvailable = function() {
            return !!this.map;
        };

        /**
         * Calls the appropriate map update function.
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number=} zoom zoom level
         */
        Geopointpicker.prototype._updateMap = function( latLng, zoom ) {
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
        Geopointpicker.prototype._updateStaticMap = function( latLng, zoom ) {
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
         * Updates the dynamic (Maps API v3) map to show the provided coordinates (in the center), with the provided zoom level
         *
         * @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         * @param  {number} zoom zoom
         */
        Geopointpicker.prototype._updateDynamicMap = function( latLng, zoom ) {
            var that = this;

            if ( !this.map ) {
                this.map = L.map( 'map' + this.mapId )
                    .on( 'click', function( e ) {
                        that._placeMarker( e.latlng );
                        that._updateInputs( e.latlng, 'change.bymap' );
                        that._updateMap( e.latlng );
                    } );

                L.tileLayer( tile[ "dynamic" ][ "source" ], {
                    attribution: tile[ "dynamic" ][ "attribution" ],
                    maxZoom: 18
                } ).addTo( this.map );

                // watch out, default "Leaflet" link clicks away from page, loosing all data
                this.map.attributionControl.setPrefix( '' );
            }
            this.map.setView( latLng, zoom );
        };

        /**
         * Moves the existing marker to the provided coordinates or places a new one in the center of the map
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number}} latLng  latitude and longitude coordinates
         */
        Geopointpicker.prototype._placeMarker = function( latLng ) {
            var that = this;

            if ( !this._dynamicMapAvailable() ) {
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

            //CENTRALIZE???
        };


        /**
         * Updates the (fake) input element for latitude, longitude, altitude and accuracy
         *
         * @param  @param  {Array.<number>|{lat: number, lng: number, alt: number, acc: number}} coords latitude, longitude, altitude and accuracy
         * @param  {string=} ev  [description]
         */
        Geopointpicker.prototype._updateInputs = function( coords, ev ) {
            var lat = coords[ 0 ] || coords.lat || '',
                lng = coords[ 1 ] || coords.lng || '',
                alt = coords[ 2 ] || coords.alt || '',
                acc = coords[ 3 ] || coords.acc || '';

            ev = ev || 'change';

            this.$lat.val( Math.round( lat * 10000 ) / 10000 || '' );
            this.$lng.val( Math.round( lng * 10000 ) / 10000 || '' );
            this.$alt.val( Math.round( alt * 10 ) / 10 || '' );
            this.$acc.val( Math.round( acc * 10 ) / 10 || '' ).trigger( ev );
        };

        Geopointpicker.prototype.disable = function() {
            this.$map.hide();
            this.$widget.find( '.btn' ).addClass( 'disabled' );
        };

        Geopointpicker.prototype.enable = function() {
            this.$map.show();
            this.$widget.find( '.btn' ).removeClass( 'disabled' );
        };


        $.fn[ pluginName ] = function( options, event ) {

            return this.each( function() {
                var $this = $( this ),
                    data = $( this ).data( pluginName );

                options = options || {};

                if ( !data && typeof options === 'object' ) {
                    $this.data( pluginName, ( data = new Geopointpicker( this, options, event ) ) );
                } else if ( data && typeof options == 'string' ) {
                    //pass the context, used for destroy() as this method is called on a cloned widget
                    data[ options ]( this );
                }
            } );
        };

    } );
