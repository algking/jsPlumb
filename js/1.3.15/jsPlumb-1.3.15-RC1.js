/*
 * jsPlumb
 * 
 * Title:jsPlumb 1.3.15
 * 
 * Provides a way to visually connect elements on an HTML page, using either SVG, Canvas
 * elements, or VML.  
 * 
 * This file contains the jsPlumb core code.
 *
 * Copyright (c) 2010 - 2012 Simon Porritt (simon.porritt@gmail.com)
 * 
 * http://jsplumb.org
 * http://github.com/sporritt/jsplumb
 * http://code.google.com/p/jsplumb
 * 
 * Dual licensed under the MIT and GPL2 licenses.
 */

;(function() {
	
	/**
	 * Class:jsPlumb
	 * The jsPlumb engine, registered as a static object in the window.  This object contains all of the methods you will use to
	 * create and maintain Connections and Endpoints.
	 */	
	
    var _findWithFunction = jsPlumbUtil.findWithFunction,
	_indexOf = jsPlumbUtil.indexOf,
    _removeWithFunction = jsPlumbUtil.removeWithFunction,
    _remove = jsPlumbUtil.remove,
    // TODO support insert index
    _addWithFunction = jsPlumbUtil.addWithFunction,
    _addToList = jsPlumbUtil.addToList,
	/**
		an isArray function that even works across iframes...see here:
		
		http://tobyho.com/2011/01/28/checking-types-in-javascript/

		i was originally using "a.constructor == Array" as a test.
	*/
	_isArray = jsPlumbUtil.isArray,
	_isString = jsPlumbUtil.isString,
	_isObject = jsPlumbUtil.isObject;
		
	var _connectionBeingDragged = null,
		_getAttribute = function(el, attName) { return jsPlumb.CurrentLibrary.getAttribute(_getElementObject(el), attName); },
		_setAttribute = function(el, attName, attValue) { jsPlumb.CurrentLibrary.setAttribute(_getElementObject(el), attName, attValue); },
		_addClass = function(el, clazz) { jsPlumb.CurrentLibrary.addClass(_getElementObject(el), clazz); },
		_hasClass = function(el, clazz) { return jsPlumb.CurrentLibrary.hasClass(_getElementObject(el), clazz); },
		_removeClass = function(el, clazz) { jsPlumb.CurrentLibrary.removeClass(_getElementObject(el), clazz); },
		_getElementObject = function(el) { return jsPlumb.CurrentLibrary.getElementObject(el); },
		_getOffset = function(el, _instance) {
            var o = jsPlumb.CurrentLibrary.getOffset(_getElementObject(el));
            if (_instance != null) {
                var z = _instance.getZoom();
                return {left:o.left / z, top:o.top / z };    
            }
            else
                return o;
        },		
		_getSize = function(el) {
            return jsPlumb.CurrentLibrary.getSize(_getElementObject(el));
        },
		_log = jsPlumbUtil.log,
		_group = jsPlumbUtil.group,
		_groupEnd = jsPlumbUtil.groupEnd,
		_time = jsPlumbUtil.time,
		_timeEnd = jsPlumbUtil.timeEnd,
		
		/**
		 * creates a timestamp, using milliseconds since 1970, but as a string.
		 */
		_timestamp = function() { return "" + (new Date()).getTime(); },
		
		/*
		 * Class:jsPlumbUIComponent
		 * Abstract superclass for UI components Endpoint and Connection.  Provides the abstraction of paintStyle/hoverPaintStyle,
		 * and also extends jsPlumbUtil.EventGenerator to provide the bind and fire methods.
		 */
		jsPlumbUIComponent = function(params) {
			var self = this, 
				a = arguments, 
				_hover = false, 
				parameters = params.parameters || {}, 
				idPrefix = self.idPrefix,
				id = idPrefix + (new Date()).getTime(),
				paintStyle = null,
				hoverPaintStyle = null;

			self._jsPlumb = params["_jsPlumb"];			
			self.getId = function() { return id; };
			self.tooltip = params.tooltip;
			self.hoverClass = params.hoverClass || self._jsPlumb.Defaults.HoverClass || jsPlumb.Defaults.HoverClass;				
			
			// all components can generate events
			jsPlumbUtil.EventGenerator.apply(this);
			// all components get this clone function.
			// TODO issue 116 showed a problem with this - it seems 'a' that is in
			// the clone function's scope is shared by all invocations of it, the classic
			// JS closure problem.  for now, jsPlumb does a version of this inline where 
			// it used to call clone.  but it would be nice to find some time to look
			// further at this.
			this.clone = function() {
				var o = new Object();
				self.constructor.apply(o, a);
				return o;
			};
			
			this.getParameter = function(name) { return parameters[name]; },
			this.getParameters = function() { 
				return parameters; 
			},
			this.setParameter = function(name, value) { parameters[name] = value; },
			this.setParameters = function(p) { parameters = p; },			
			this.overlayPlacements = [];			
			
			// user can supply a beforeDetach callback, which will be executed before a detach
			// is performed; returning false prevents the detach.
			var beforeDetach = params.beforeDetach;
			this.isDetachAllowed = function(connection) {
				var r = self._jsPlumb.checkCondition("beforeDetach", connection );
				if (beforeDetach) {
					try { 
						r = beforeDetach(connection); 
					}
					catch (e) { _log("jsPlumb: beforeDetach callback failed", e); }
				}
				return r;
			};
			
			// user can supply a beforeDrop callback, which will be executed before a dropped
			// connection is confirmed. user can return false to reject connection.
			var beforeDrop = params.beforeDrop;
			this.isDropAllowed = function(sourceId, targetId, scope, connection, dropEndpoint) {
				var r = self._jsPlumb.checkCondition("beforeDrop", { 
					sourceId:sourceId, 
					targetId:targetId, 
					scope:scope,
					connection:connection,
					dropEndpoint:dropEndpoint 
				});
				if (beforeDrop) {
					try { 
						r = beforeDrop({ 
							sourceId:sourceId, 
							targetId:targetId, 
							scope:scope, 
							connection:connection,
							dropEndpoint:dropEndpoint
						}); 
					}
					catch (e) { _log("jsPlumb: beforeDrop callback failed", e); }
				}
				return r;
			};
			
			// helper method to update the hover style whenever it, or paintStyle, changes.
			// we use paintStyle as the foundation and merge hoverPaintStyle over the
			// top.
			var _updateHoverStyle = function() {
				if (paintStyle && hoverPaintStyle) {
					var mergedHoverStyle = {};
					jsPlumb.extend(mergedHoverStyle, paintStyle);
					jsPlumb.extend(mergedHoverStyle, hoverPaintStyle);
					delete self["hoverPaintStyle"];
					// we want the fillStyle of paintStyle to override a gradient, if possible.
					if (mergedHoverStyle.gradient && paintStyle.fillStyle)
						delete mergedHoverStyle["gradient"];
					hoverPaintStyle = mergedHoverStyle;
				}
			};
			
			/*
		     * Sets the paint style and then repaints the element.
		     * 
		     * Parameters:
		     * 	style - Style to use.
		     */
		    this.setPaintStyle = function(style, doNotRepaint) {
		    	paintStyle = style;
		    	self.paintStyleInUse = paintStyle;
		    	_updateHoverStyle();
		    	if (!doNotRepaint) self.repaint();
		    };

		    /**
		    * Gets the component's paint style.
		    *
		    * Returns:
		    * the component's paint style. if there is no hoverPaintStyle set then this will be the paint style used all the time, otherwise this is the style used when the mouse is not hovering.
		    */
		    this.getPaintStyle = function() {
		    	return paintStyle;
		    };
		    
		    /*
		     * Sets the paint style to use when the mouse is hovering over the element. This is null by default.
		     * The hover paint style is applied as extensions to the paintStyle; it does not entirely replace
		     * it.  This is because people will most likely want to change just one thing when hovering, say the
		     * color for example, but leave the rest of the appearance the same.
		     * 
		     * Parameters:
		     * 	style - Style to use when the mouse is hovering.
		     *  doNotRepaint - if true, the component will not be repainted.  useful when setting things up initially.
		     */
		    this.setHoverPaintStyle = function(style, doNotRepaint) {		    	
		    	hoverPaintStyle = style;
		    	_updateHoverStyle();
		    	if (!doNotRepaint) self.repaint();
		    };

		    /**
		    * Gets the component's hover paint style.
		    *
		    * Returns:
		    * the component's hover paint style. may be null.
		    */
		    this.getHoverPaintStyle = function() {
		    	return hoverPaintStyle;
		    };
		    
		    /*
		     * sets/unsets the hover state of this element.
		     * 
		     * Parameters:
		     * 	hover - hover state boolean
		     * 	ignoreAttachedElements - if true, does not notify any attached elements of the change in hover state.  used mostly to avoid infinite loops.
		     */
		    this.setHover = function(hover, ignoreAttachedElements, timestamp) {
		    	// while dragging, we ignore these events.  this keeps the UI from flashing and
		    	// swishing and whatevering.
				if (!self._jsPlumb.currentlyDragging && !self._jsPlumb.isHoverSuspended()) {
		    
			    	_hover = hover;
					if (self.hoverClass != null && self.canvas != null) {
						if (hover) 
							jpcl.addClass(self.canvas, self.hoverClass);						
						else
							jpcl.removeClass(self.canvas, self.hoverClass);
					}
		   		 	if (hoverPaintStyle != null) {
						self.paintStyleInUse = hover ? hoverPaintStyle : paintStyle;
						timestamp = timestamp || _timestamp();
						self.repaint({timestamp:timestamp, recalc:false});
					}
					// get the list of other affected elements, if supported by this component.
					// for a connection, its the endpoints.  for an endpoint, its the connections! surprise.
					if (self.getAttachedElements && !ignoreAttachedElements)
						_updateAttachedElements(hover, _timestamp(), self);
				}
		    };
		    
		    this.isHover = function() { return _hover; };
			
			var zIndex = null;
			this.setZIndex = function(v) { zIndex = v; };
			this.getZIndex = function() { return zIndex; };

			var jpcl = jsPlumb.CurrentLibrary,
				events = [ "click", "dblclick", "mouseenter", "mouseout", "mousemove", "mousedown", "mouseup", "contextmenu" ],
				eventFilters = { "mouseout":"mouseexit" },
				bindOne = function(o, c, evt) {
					var filteredEvent = eventFilters[evt] || evt;
					jpcl.bind(o, evt, function(ee) {
						c.fire(filteredEvent, c, ee);
					});
				},
				unbindOne = function(o, evt) {
					var filteredEvent = eventFilters[evt] || evt;
					jpcl.unbind(o, evt);
				};
		    
		    this.attachListeners = function(o, c) {
				for (var i = 0; i < events.length; i++) {
					bindOne(o, c, events[i]); 			
				}
			};
		    
		    var _updateAttachedElements = function(state, timestamp, sourceElement) {
		    	var affectedElements = self.getAttachedElements();		// implemented in subclasses
		    	if (affectedElements) {
		    		for (var i = 0; i < affectedElements.length; i++) {
		    			if (!sourceElement || sourceElement != affectedElements[i])
		    				affectedElements[i].setHover(state, true, timestamp);			// tell the attached elements not to inform their own attached elements.
		    		}
		    	}
		    };
		    
		    this.reattachListenersForElement = function(o) {
			    if (arguments.length > 1) {
		    		for (var i = 0; i < events.length; i++)
		    			unbindOne(o, events[i]);
			    	for (var i = 1; i < arguments.length; i++)
		    			self.attachListeners(o, arguments[i]);
		    	}
		    };
			
			/*
			 * TYPES
			 */
			var _types = [],
				_splitType = function(t) { return t == null ? null : t.split(" ")},				
				_applyTypes = function(doNotRepaint) {
					if (self.getDefaultType) {
						var td = self.getTypeDescriptor();
							
						var o = jsPlumbUtil.merge({}, self.getDefaultType());
						for (var i = 0; i < _types.length; i++)
							o = jsPlumbUtil.merge(o, self._jsPlumb.getType(_types[i], td));						
					
						self.applyType(o);					
						if (!doNotRepaint) self.repaint();
					}
				};
				
			self.setType = function(typeId, doNotRepaint) {				
				_types = _splitType(typeId) || [];
				_applyTypes(doNotRepaint);									
			};
			
			/*
			 * Function : getType
			 * Gets the 'types' of this component.
			 */
			self.getType = function() {
				return _types;
			};
			
			self.hasType = function(typeId) {
				return jsPlumbUtil.indexOf(_types, typeId) != -1;
			};
			
			self.addType = function(typeId, doNotRepaint) {
				var t = _splitType(typeId), _cont = false;
				if (t != null) {
					for (var i = 0; i < t.length; i++) {
						if (!self.hasType(t[i])) {
							_types.push(t[i]);
							_cont = true;						
						}
					}
					if (_cont) _applyTypes(doNotRepaint);
				}
			};
			
			self.removeType = function(typeId, doNotRepaint) {
				var t = _splitType(typeId), _cont = false, _one = function(tt) {
					var idx = jsPlumbUtil.indexOf(_types, tt);
					if (idx != -1) {
						_types.splice(idx, 1);
						return true;
					}
					return false;
				};
				
				if (t != null) {
					for (var i = 0; i < t.length; i++) {
						_cont = _one(t[i]) || _cont;
					}
					if (_cont) _applyTypes(doNotRepaint);
				}
			};
			
			self.toggleType = function(typeId, doNotRepaint) {
				var t = _splitType(typeId);
				if (t != null) {
					for (var i = 0; i < t.length; i++) {
						var idx = jsPlumbUtil.indexOf(_types, t[i]);
						if (idx != -1)
							_types.splice(idx, 1);
						else
							_types.push(t[i]);
					}
						
					_applyTypes(doNotRepaint);
				}
			};
			
			this.applyType = function(t) {
				self.setPaintStyle(t.paintStyle);				
				self.setHoverPaintStyle(t.hoverPaintStyle);
				if (t.parameters){
					for (var i in t.parameters)
						self.setParameter(i, t.parameters[i]);
				}
			};
			
		},

		overlayCapableJsPlumbUIComponent = function(params) {
			jsPlumbUIComponent.apply(this, arguments);
			var self = this;			
			this.overlays = [];

			var processOverlay = function(o) {
				var _newOverlay = null;
				if (_isArray(o)) {	// this is for the shorthand ["Arrow", { width:50 }] syntax
					// there's also a three arg version:
					// ["Arrow", { width:50 }, {location:0.7}] 
					// which merges the 3rd arg into the 2nd.
					var type = o[0],
						// make a copy of the object so as not to mess up anyone else's reference...
						p = jsPlumb.extend({component:self, _jsPlumb:self._jsPlumb}, o[1]);
					if (o.length == 3) jsPlumb.extend(p, o[2]);
					_newOverlay = new jsPlumb.Overlays[self._jsPlumb.getRenderMode()][type](p);
					if (p.events) {
						for (var evt in p.events) {
							_newOverlay.bind(evt, p.events[evt]);
						}
					}
				} else if (o.constructor == String) {
					_newOverlay = new jsPlumb.Overlays[self._jsPlumb.getRenderMode()][o]({component:self, _jsPlumb:self._jsPlumb});
				} else {
					_newOverlay = o;
				}										
					
				self.overlays.push(_newOverlay);
			},
			calculateOverlaysToAdd = function(params) {
				var defaultKeys = self.defaultOverlayKeys || [],
					o = params.overlays,
					checkKey = function(k) {
						return self._jsPlumb.Defaults[k] || jsPlumb.Defaults[k] || [];
					};
				
				if (!o) o = [];

				for (var i = 0; i < defaultKeys.length; i++)
					o.unshift.apply(o, checkKey(defaultKeys[i]));
				
				return o;
			}

			var _overlays = calculateOverlaysToAdd(params);//params.overlays || self._jsPlumb.Defaults.Overlays;
			if (_overlays) {
				for (var i = 0; i < _overlays.length; i++) {
					processOverlay(_overlays[i]);
				}
			}

		    // overlay finder helper method
			var _getOverlayIndex = function(id) {
				var idx = -1;
				for (var i = 0; i < self.overlays.length; i++) {
					if (id === self.overlays[i].id) {
						idx = i;
						break;
					}
				}
				return idx;
			};
						
			this.addOverlay = function(overlay, doNotRepaint) { 
				processOverlay(overlay); 
				if (!doNotRepaint) self.repaint();
			};
						
			this.getOverlay = function(id) {
				var idx = _getOverlayIndex(id);
				return idx >= 0 ? self.overlays[idx] : null;
			};
			
			this.getOverlays = function() {
				return self.overlays;
			};			
			
			this.hideOverlay = function(id) {
				var o = self.getOverlay(id);
				if (o) o.hide();
			};

			this.hideOverlays = function() {
				for (var i = 0; i < self.overlays.length; i++)
					self.overlays[i].hide();
			};
						
			this.showOverlay = function(id) {
				var o = self.getOverlay(id);
				if (o) o.show();
			};

			this.showOverlays = function() {
				for (var i = 0; i < self.overlays.length; i++)
					self.overlays[i].show();
			};
			
			this.removeAllOverlays = function() {
				for (var i = 0; i < self.overlays.length; i++) {
					if (self.overlays[i].cleanup) self.overlays[i].cleanup();
				}

				self.overlays.splice(0, self.overlays.length);
				self.repaint();
			};
						
			this.removeOverlay = function(overlayId) {
				var idx = _getOverlayIndex(overlayId);
				if (idx != -1) {
					var o = self.overlays[idx];
					if (o.cleanup) o.cleanup();
					self.overlays.splice(idx, 1);
				}
			};
						
			this.removeOverlays = function() {
				for (var i = 0; i < arguments.length; i++)
					self.removeOverlay(arguments[i]);
			};

			// this is a shortcut helper method to let people add a label as
			// overlay.			
			var _internalLabelOverlayId = "__label",
			_makeLabelOverlay = function(params) {

				var _params = {
					cssClass:params.cssClass,
					labelStyle : this.labelStyle,					
					id:_internalLabelOverlayId,
					component:self,
					_jsPlumb:self._jsPlumb
				},
				mergedParams = jsPlumb.extend(_params, params);

				return new jsPlumb.Overlays[self._jsPlumb.getRenderMode()].Label( mergedParams );
			};
			if (params.label) {
				var loc = params.labelLocation || self.defaultLabelLocation || 0.5,
					labelStyle = params.labelStyle || self._jsPlumb.Defaults.LabelStyle || jsPlumb.Defaults.LabelStyle;			
				this.overlays.push(_makeLabelOverlay({
					label:params.label,
					location:loc,
					labelStyle:labelStyle
				}));
			}

			
			this.setLabel = function(l) {
				var lo = self.getOverlay(_internalLabelOverlayId);
				if (!lo) {
					var params = l.constructor == String || l.constructor == Function ? { label:l } : l;
					lo = _makeLabelOverlay(params);	
					this.overlays.push(lo);
				}
				else {
					if (l.constructor == String || l.constructor == Function) lo.setLabel(l);
					else {
						if (l.label) lo.setLabel(l.label);
						if (l.location) lo.setLocation(l.location);
					}
				}
				
				if (!self._jsPlumb.isSuspendDrawing()) 
					self.repaint();
			};

			
			this.getLabel = function() {
				var lo = self.getOverlay(_internalLabelOverlayId);
				return lo != null ? lo.getLabel() : null;
			};

			
			this.getLabelOverlay = function() {
				return self.getOverlay(_internalLabelOverlayId);
			};
			
			var superAt = this.applyType;
			this.applyType = function(t) {
				superAt(t);
				self.removeAllOverlays();
				if (t.overlays) {
					for (var i = 0; i < t.overlays.length; i++)
						self.addOverlay(t.overlays[i], true);
				}
			};
		},
		
		_bindListeners = function(obj, _self, _hoverFunction) {
        	obj.bind("click", function(ep, e) { _self.fire("click", _self, e); });
			obj.bind("dblclick", function(ep, e) { _self.fire("dblclick", _self, e); });
	        obj.bind("contextmenu", function(ep, e) { _self.fire("contextmenu", _self, e); });
			obj.bind("mouseenter", function(ep, e) {
				if (!_self.isHover()) {
	                _hoverFunction(true);
					_self.fire("mouseenter", _self, e);
				}
			});
			obj.bind("mouseexit", function(ep, e) {
				if (_self.isHover()) {
	                _hoverFunction(false);
					_self.fire("mouseexit", _self, e);
				}
			});	
        };	
		
		var _jsPlumbInstanceIndex = 0,
			getInstanceIndex = function() {
				var i = _jsPlumbInstanceIndex + 1;
				_jsPlumbInstanceIndex++;
				return i;
			};

		var jsPlumbInstance = function(_defaults) {
		
		/*
		 * Property: Defaults 
		 * 
		 * These are the default settings for jsPlumb.  They are what will be used if you do not supply specific pieces of information 
		 * to the various API calls. A convenient way to implement your own look and feel can be to override these defaults 
		 * by including a script somewhere after the jsPlumb include, but before you make any calls to jsPlumb.
		 * 
		 * Properties:
		 * 	-	*Anchor*				    The default anchor to use for all connections (both source and target). Default is "BottomCenter".
		 * 	-	*Anchors*				    The default anchors to use ([source, target]) for all connections. Defaults are ["BottomCenter", "BottomCenter"].
		 *  -   *ConnectionsDetachable*		Whether or not connections are detachable by default (using the mouse). Defaults to true.
		 *  -   *ConnectionOverlays*		The default overlay definitions for Connections. Defaults to an empty list.
		 * 	-	*Connector*				The default connector definition to use for all connections.  Default is "Bezier".
		 * 	-   *ConnectorZIndex*       Optional value for the z-index of Connections that are not in the hover state. If you set this, jsPlumb will set the z-index of all created Connections to be this value, and the z-index of any Connections in the hover state to be this value plus one. This brings hovered connections up on top of others, which is a nice effect in busy UIs.
		 *  -   *Container*				Optional selector or element id that instructs jsPlumb to append elements it creates to a specific element.
		 * 	-	*DragOptions*			The default drag options to pass in to connect, makeTarget and addEndpoint calls. Default is empty.
		 * 	-	*DropOptions*			The default drop options to pass in to connect, makeTarget and addEndpoint calls. Default is empty.
		 * 	-	*Endpoint*				The default endpoint definition to use for all connections (both source and target).  Default is "Dot".
		 *  -   *EndpointOverlays*		The default overlay definitions for Endpoints. Defaults to an empty list.
		 * 	-	*Endpoints*				The default endpoint definitions ([ source, target ]) to use for all connections.  Defaults are ["Dot", "Dot"].
		 * 	-	*EndpointStyle*			The default style definition to use for all endpoints. Default is fillStyle:"#456".
		 * 	-	*EndpointStyles*		The default style definitions ([ source, target ]) to use for all endpoints.  Defaults are empty.
		 * 	-	*EndpointHoverStyle*	The default hover style definition to use for all endpoints. Default is null.
		 * 	-	*EndpointHoverStyles*	The default hover style definitions ([ source, target ]) to use for all endpoints. Defaults are null.
		 * 	-	*HoverPaintStyle*		The default hover style definition to use for all connections. Defaults are null.
		 * 	-	*LabelStyle*			The default style to use for label overlays on connections.
		 * 	-	*LogEnabled*			Whether or not the jsPlumb log is enabled. defaults to false.
		 * 	-	*Overlays*				The default overlay definitions (for both Connections and Endpoint). Defaults to an empty list.
		 * 	-	*MaxConnections*		The default maximum number of connections for an Endpoint.  Defaults to 1.		 
		 * 	-	*PaintStyle*			The default paint style for a connection. Default is line width of 8 pixels, with color "#456".
		 * 	-	*ReattachConnections*	Whether or not to reattach Connections that a user has detached with the mouse and then dropped. Default is false.
		 * 	-	*RenderMode*			What mode to use to paint with.  If you're on IE<9, you don't really get to choose this.  You'll just get VML.  Otherwise, the jsPlumb default is to use SVG.
		 * 	-	*Scope*				The default "scope" to use for connections. Scope lets you assign connections to different categories. 
		 */
		this.Defaults = {
			Anchor : "BottomCenter",
			Anchors : [ null, null ],
            ConnectionsDetachable : true,
            ConnectionOverlays : [ ],
            Connector : "Bezier",
			ConnectorZIndex : null,
			Container : null,
			DragOptions : { },
			DropOptions : { },
			Endpoint : "Dot",
			EndpointOverlays : [ ],
			Endpoints : [ null, null ],
			EndpointStyle : { fillStyle : "#456" },
			EndpointStyles : [ null, null ],
			EndpointHoverStyle : null,
			EndpointHoverStyles : [ null, null ],
			HoverPaintStyle : null,
			LabelStyle : { color : "black" },
			LogEnabled : false,
			Overlays : [ ],
			MaxConnections : 1, 
			PaintStyle : { lineWidth : 8, strokeStyle : "#456" },            
			ReattachConnections:false,
			RenderMode : "svg",
			Scope : "jsPlumb_DefaultScope"
		};
		if (_defaults) jsPlumb.extend(this.Defaults, _defaults);
		
		this.logEnabled = this.Defaults.LogEnabled;
		
		var _connectionTypes = { }, _endpointTypes = {};
		this.registerConnectionType = function(id, type) {
			_connectionTypes[id] = jsPlumb.extend({}, type);
		};
		this.registerConnectionTypes = function(types) {
			for (var i in types)
				_connectionTypes[i] = jsPlumb.extend({}, types[i]);
		};
		this.registerEndpointType = function(id, type) {
			_endpointTypes[id] = jsPlumb.extend({}, type);
		};
		this.registerEndpointTypes = function(types) {
			for (var i in types)
				_endpointTypes[i] = jsPlumb.extend({}, types[i]);
		};
		this.getType = function(id, typeDescriptor) {
			return typeDescriptor ===  "connection" ? _connectionTypes[id] : _endpointTypes[id];
		};

		jsPlumbUtil.EventGenerator.apply(this);
		var _currentInstance = this,
			_instanceIndex = getInstanceIndex(),
			_bb = _currentInstance.bind,
			_initialDefaults = {},
            _zoom = 1;
            
        this.setZoom = function(z, repaintEverything) {
            _zoom = z;
            if (repaintEverything) _currentInstance.repaintEverything();
        };
        this.getZoom = function() { return _zoom; };

		for (var i in this.Defaults)
			_initialDefaults[i] = this.Defaults[i];

		this.bind = function(event, fn) {		
			if ("ready" === event && initialized) fn();
			else _bb.apply(_currentInstance,[event, fn]);
		};

		/*
			Function: importDefaults
			Imports all the given defaults into this instance of jsPlumb.
		*/
		_currentInstance.importDefaults = function(d) {
			for (var i in d) {
				_currentInstance.Defaults[i] = d[i];
			}	
		};

		/*
			Function:restoreDefaults
			Restores the default settings to "factory" values.
		*/
		_currentInstance.restoreDefaults = function() {
			_currentInstance.Defaults = jsPlumb.extend({}, _initialDefaults);
		};
		
    var log = null,
        resizeTimer = null,
        initialized = false,
        connectionsByScope = {},
        /**
         * map of element id -> endpoint lists. an element can have an arbitrary
         * number of endpoints on it, and not all of them have to be connected
         * to anything.
         */
        endpointsByElement = {},
        endpointsByUUID = {},
        offsets = {},
        offsetTimestamps = {},
        floatingConnections = {},
        draggableStates = {},		
        canvasList = [],
        sizes = [],
        //listeners = {}, // a map: keys are event types, values are lists of listeners.
        DEFAULT_SCOPE = this.Defaults.Scope,
        renderMode = null,  // will be set in init()							

		/**
		 * helper method to add an item to a list, creating the list if it does
		 * not yet exist.
		 */
		_addToList = function(map, key, value) {
			var l = map[key];
			if (l == null) {
				l = [];
				map[key] = l;
			}
			l.push(value);
			return l;
		},

		/**
		 * appends an element to some other element, which is calculated as follows:
		 * 
		 * 1. if _currentInstance.Defaults.Container exists, use that element.
		 * 2. if the 'parent' parameter exists, use that.
		 * 3. otherwise just use the root element (for DOM usage, the document body).
		 * 
		 */
		_appendElement = function(el, parent) {
			if (_currentInstance.Defaults.Container)
				jsPlumb.CurrentLibrary.appendElement(el, _currentInstance.Defaults.Container);
			else if (!parent)
				//document.body.appendChild(el);
				jsPlumbAdapter.appendToRoot(el);
			else
				jsPlumb.CurrentLibrary.appendElement(el, parent);
		},

		_curIdStamp = 1,
		_idstamp = function() { return "" + _curIdStamp++; },		
		
		/**
		 * YUI, for some reason, put the result of a Y.all call into an object that contains
		 * a '_nodes' array, instead of handing back an array-like object like the other
		 * libraries do.
		 */
		_convertYUICollection = function(c) {
			return c._nodes ? c._nodes : c;
		},                

		/**
		 * Draws an endpoint and its connections. this is the main entry point into drawing connections as well
		 * as endpoints, since jsPlumb is endpoint-centric under the hood.
		 * 
		 * @param element element to draw (of type library specific element object)
		 * @param ui UI object from current library's event system. optional.
		 * @param timestamp timestamp for this paint cycle. used to speed things up a little by cutting down the amount of offset calculations we do.
		 */
		_draw = function(element, ui, timestamp) {
			
			// TOD is it correct to filter by headless at this top level? how would a headless adapter ever repaint?
            if (!jsPlumbAdapter.headless && !_suspendDrawing) {
			    var id = _getAttribute(element, "id"),
			    	repaintEls = _currentInstance.dragManager.getElementsForDraggable(id);			    

			    if (timestamp == null) timestamp = _timestamp();

			    _currentInstance.anchorManager.redraw(id, ui, timestamp);

			    if (repaintEls) {
				    for (var i in repaintEls) {
						_currentInstance.anchorManager.redraw(repaintEls[i].id, ui, timestamp, repaintEls[i].offset);			    	
				    }
				}
            }
		},

		/**
		 * executes the given function against the given element if the first
		 * argument is an object, or the list of elements, if the first argument
		 * is a list. the function passed in takes (element, elementId) as
		 * arguments.
		 */
		_elementProxy = function(element, fn) {
			var retVal = null;
			if (_isArray(element)) {
				retVal = [];
				for ( var i = 0; i < element.length; i++) {
					var el = _getElementObject(element[i]), id = _getAttribute(el, "id");
					retVal.push(fn(el, id)); // append return values to what we will return
				}
			} else {
				var el = _getElementObject(element), id = _getAttribute(el, "id");
				retVal = fn(el, id);
			}
			return retVal;
		},				

		/**
		 * gets an Endpoint by uuid.
		 */
		_getEndpoint = function(uuid) { return endpointsByUUID[uuid]; },

		/**
		 * inits a draggable if it's not already initialised.
		 */
		_initDraggableIfNecessary = function(element, isDraggable, dragOptions) {
			// TODO move to DragManager?
			if (!jsPlumbAdapter.headless) {
				var draggable = isDraggable == null ? false : isDraggable,
					jpcl = jsPlumb.CurrentLibrary;
				if (draggable) {
					if (jpcl.isDragSupported(element) && !jpcl.isAlreadyDraggable(element)) {
						var options = dragOptions || _currentInstance.Defaults.DragOptions || jsPlumb.Defaults.DragOptions;
						options = jsPlumb.extend( {}, options); // make a copy.
						var dragEvent = jpcl.dragEvents["drag"],
							stopEvent = jpcl.dragEvents["stop"],
							startEvent = jpcl.dragEvents["start"];
	
						options[startEvent] = _wrap(options[startEvent], function() {
							_currentInstance.setHoverSuspended(true);
						});
	
						options[dragEvent] = _wrap(options[dragEvent], function() {                            
							var ui = jpcl.getUIPosition(arguments, _currentInstance.getZoom());
							_draw(element, ui);
							_addClass(element, "jsPlumb_dragged");
						});
						options[stopEvent] = _wrap(options[stopEvent], function() {
							var ui = jpcl.getUIPosition(arguments, _currentInstance.getZoom());
							_draw(element, ui);
							_removeClass(element, "jsPlumb_dragged");
							_currentInstance.setHoverSuspended(false);
						});
						var elId = _getId(element); // need ID
						draggableStates[elId] = true;  
						var draggable = draggableStates[elId];
						options.disabled = draggable == null ? false : !draggable;
						jpcl.initDraggable(element, options, false);
						_currentInstance.dragManager.register(element);
					}
				}
			}
		},
		
		/*
		* prepares a final params object that can be passed to _newConnection, taking into account defaults, events, etc.
		*/
		_prepareConnectionParams = function(params, referenceParams) {
			var _p = jsPlumb.extend( {
				sourceIsNew:true,
				targetIsNew:true
			}, params);
			if (referenceParams) jsPlumb.extend(_p, referenceParams);
			
			// hotwire endpoints passed as source or target to sourceEndpoint/targetEndpoint, respectively.
			if (_p.source && _p.source.endpoint) _p.sourceEndpoint = _p.source;
			if (_p.source && _p.target.endpoint) _p.targetEndpoint = _p.target;
			
			// test for endpoint uuids to connect
			if (params.uuids) {
				_p.sourceEndpoint = _getEndpoint(params.uuids[0]);
				_p.targetEndpoint = _getEndpoint(params.uuids[1]);
			}						

			// now ensure that if we do have Endpoints already, they're not full.
			// source:
			if (_p.sourceEndpoint && _p.sourceEndpoint.isFull()) {
				_log(_currentInstance, "could not add connection; source endpoint is full");
				return;
			}

			// target:
			if (_p.targetEndpoint && _p.targetEndpoint.isFull()) {
				_log(_currentInstance, "could not add connection; target endpoint is full");
				return;
			}
			
			// at this point, if we have source or target Endpoints, they were not new and we should mark the
			// flag to reflect that.  this is for use later with the deleteEndpointsOnDetach flag.
			if (_p.sourceEndpoint) _p.sourceIsNew = false;
			if (_p.targetEndpoint) _p.targetIsNew = false;
			
			// if source endpoint mandates connection type and nothing specified in our params, use it.
			if (!_p.type && _p.sourceEndpoint)
				_p.type = _p.sourceEndpoint.connectionType;
			
			// copy in any connectorOverlays that were specified on the source endpoint.
			// it doesnt copy target endpoint overlays.  i'm not sure if we want it to or not.
			if (_p.sourceEndpoint && _p.sourceEndpoint.connectorOverlays) {
				_p.overlays = _p.overlays || [];
				for (var i = 0; i < _p.sourceEndpoint.connectorOverlays.length; i++) {
					_p.overlays.push(_p.sourceEndpoint.connectorOverlays[i]);
				}
			}			
			
			// tooltip.  params.tooltip takes precedence, then sourceEndpoint.connectorTooltip.
			_p.tooltip = params.tooltip;
			if (!_p.tooltip && _p.sourceEndpoint && _p.sourceEndpoint.connectorTooltip)
				_p.tooltip = _p.sourceEndpoint.connectorTooltip;
			
			// if there's a target specified (which of course there should be), and there is no
			// target endpoint specified, and 'newConnection' was not set to true, then we check to
			// see if a prior call to makeTarget has provided us with the specs for the target endpoint, and
			// we use those if so.  additionally, if the makeTarget call was specified with 'uniqueEndpoint' set
			// to true, then if that target endpoint has already been created, we re-use it.
			if (_p.target && !_p.target.endpoint && !_p.targetEndpoint && !_p.newConnection) {				
				var tid = _getId(_p.target),
					tep =_targetEndpointDefinitions[tid],
					existingUniqueEndpoint = _targetEndpoints[tid];				

				if (tep) {			
					// if target not enabled, return.
					if (!_targetsEnabled[tid]) return;

					// check for max connections??						
					var newEndpoint = existingUniqueEndpoint != null ? existingUniqueEndpoint : _currentInstance.addEndpoint(_p.target, tep);
					if (_targetEndpointsUnique[tid]) _targetEndpoints[tid] = newEndpoint;
					 _p.targetEndpoint = newEndpoint;
					 newEndpoint._makeTargetCreator = true;
					 _p.targetIsNew = true;
				}
			}

			// same thing, but for source.
			if (_p.source && !_p.source.endpoint && !_p.sourceEndpoint && !_p.newConnection) {
				var tid = _getId(_p.source),
					tep = _sourceEndpointDefinitions[tid],
					existingUniqueEndpoint = _sourceEndpoints[tid];				

				if (tep) {
					// if source not enabled, return.					
					if (!_sourcesEnabled[tid]) return;
				
					var newEndpoint = existingUniqueEndpoint != null ? existingUniqueEndpoint : _currentInstance.addEndpoint(_p.source, tep);
					if (_sourceEndpointsUnique[tid]) _sourceEndpoints[tid] = newEndpoint;
					 _p.sourceEndpoint = newEndpoint;
					 _p.sourceIsNew = true;
				}
			}
			
			return _p;
		},
		
		_newConnection = function(params) {
			var connectionFunc = _currentInstance.Defaults.ConnectionType || _currentInstance.getDefaultConnectionType(),
			    endpointFunc = _currentInstance.Defaults.EndpointType || Endpoint,
			    parent = jsPlumb.CurrentLibrary.getParent;
			
			if (params.container)
				params["parent"] = params.container;
			else {
				if (params.sourceEndpoint)
					params["parent"] = params.sourceEndpoint.parent;
				else if (params.source.constructor == endpointFunc)
					params["parent"] = params.source.parent;
				else params["parent"] = parent(params.source);
			}
			
			params["_jsPlumb"] = _currentInstance;
			var con = new connectionFunc(params);
			con.id = "con_" + _idstamp();
			_eventFireProxy("click", "click", con);
			_eventFireProxy("dblclick", "dblclick", con);
            _eventFireProxy("contextmenu", "contextmenu", con);
			return con;
		},
		
		/**
		* adds the connection to the backing model, fires an event if necessary and then redraws
		*/
		_finaliseConnection = function(jpc, params, originalEvent) {
            params = params || {};
			// add to list of connections (by scope).
            if (!jpc.suspendedEndpoint)
			    _addToList(connectionsByScope, jpc.scope, jpc);
			// fire an event
			if (!params.doNotFireConnectionEvent && params.fireEvent !== false) {
			
				var eventArgs = {
					connection:jpc,
					source : jpc.source, target : jpc.target,
					sourceId : jpc.sourceId, targetId : jpc.targetId,
					sourceEndpoint : jpc.endpoints[0], targetEndpoint : jpc.endpoints[1]
				};
			
				_currentInstance.fire("jsPlumbConnection", eventArgs, originalEvent);
				// this is from 1.3.11 onwards. "jsPlumbConnection" always felt so unnecessary, so
				// I've added this alias in 1.3.11, with a view to removing "jsPlumbConnection" completely in a future version. be aware, of course, you should only register listeners for one or the other of these events.
				_currentInstance.fire("connection", eventArgs, originalEvent);
			}		
			
            // always inform the anchor manager
            // except that if jpc has a suspended endpoint it's not true to say the
            // connection is new; it has just (possibly) moved. the question is whether
            // to make that call here or in the anchor manager.  i think perhaps here.
            _currentInstance.anchorManager.newConnection(jpc);
			// force a paint
			_draw(jpc.source);
		},
		
		_eventFireProxy = function(event, proxyEvent, obj) {
			obj.bind(event, function(originalObject, originalEvent) {
				_currentInstance.fire(proxyEvent, obj, originalEvent);
			});
		},
		
		/**
		 * for the given endpoint params, returns an appropriate parent element for the UI elements that will be added.
		 * this function is used by _newEndpoint (directly below), and also in the makeSource function in jsPlumb.
		 * 
		 *   the logic is to first look for a "container" member of params, and pass that back if found.  otherwise we
		 *   handoff to the 'getParent' function in the current library.
		 */
		_getParentFromParams = function(params) {
			if (params.container)
				return params.container;
			else {
                var tag = jsPlumb.CurrentLibrary.getTagName(params.source),
                    p = jsPlumb.CurrentLibrary.getParent(params.source);
                if (tag && tag.toLowerCase() === "td")
                    return jsPlumb.CurrentLibrary.getParent(p);
                else return p;
            }
		},
		
		/**
			factory method to prepare a new endpoint.  this should always be used instead of creating Endpoints
			manually, since this method attaches event listeners and an id.
		*/
		_newEndpoint = function(params) {
				var endpointFunc = _currentInstance.Defaults.EndpointType || Endpoint;
				params.parent = _getParentFromParams(params);
				params["_jsPlumb"] = _currentInstance;
				var ep = new endpointFunc(params);
				ep.id = "ep_" + _idstamp();
				_eventFireProxy("click", "endpointClick", ep);
				_eventFireProxy("dblclick", "endpointDblClick", ep);
				_eventFireProxy("contextmenu", "contextmenu", ep);
				if (!jsPlumbAdapter.headless)
					_currentInstance.dragManager.endpointAdded(params.source);
			return ep;
		},
		
		/**
		 * performs the given function operation on all the connections found
		 * for the given element id; this means we find all the endpoints for
		 * the given element, and then for each endpoint find the connectors
		 * connected to it. then we pass each connection in to the given
		 * function.
		 */
		_operation = function(elId, func, endpointFunc) {
			var endpoints = endpointsByElement[elId];
			if (endpoints && endpoints.length) {
				for ( var i = 0; i < endpoints.length; i++) {
					for ( var j = 0; j < endpoints[i].connections.length; j++) {
						var retVal = func(endpoints[i].connections[j]);
						// if the function passed in returns true, we exit.
						// most functions return false.
						if (retVal) return;
					}
					if (endpointFunc) endpointFunc(endpoints[i]);
				}
			}
		},
		/**
		 * perform an operation on all elements.
		 */
		_operationOnAll = function(func) {
			for ( var elId in endpointsByElement) {
				_operation(elId, func);
			}
		},		
		
		/**
		 * helper to remove an element from the DOM.
		 */
		_removeElement = function(element, parent) {
			if (element != null && element.parentNode != null) {
				element.parentNode.removeChild(element);
			}
		},
		/**
		 * helper to remove a list of elements from the DOM.
		 */
		_removeElements = function(elements, parent) {
			for ( var i = 0; i < elements.length; i++)
				_removeElement(elements[i], parent);
		},
		/**
		 * Sets whether or not the given element(s) should be draggable,
		 * regardless of what a particular plumb command may request.
		 * 
		 * @param element
		 *            May be a string, a element objects, or a list of
		 *            strings/elements.
		 * @param draggable
		 *            Whether or not the given element(s) should be draggable.
		 */
		_setDraggable = function(element, draggable) {
			return _elementProxy(element, function(el, id) {
				draggableStates[id] = draggable;
				if (jsPlumb.CurrentLibrary.isDragSupported(el)) {
					jsPlumb.CurrentLibrary.setDraggable(el, draggable);
				}
			});
		},
		/**
		 * private method to do the business of hiding/showing.
		 * 
		 * @param el
		 *            either Id of the element in question or a library specific
		 *            object for the element.
		 * @param state
		 *            String specifying a value for the css 'display' property
		 *            ('block' or 'none').
		 */
		_setVisible = function(el, state, alsoChangeEndpoints) {
			state = state === "block";
			var endpointFunc = null;
			if (alsoChangeEndpoints) {
				if (state) endpointFunc = function(ep) {
					ep.setVisible(true, true, true);
				};
				else endpointFunc = function(ep) {
					ep.setVisible(false, true, true);
				};
			}
			var id = _getAttribute(el, "id");
			_operation(id, function(jpc) {
				if (state && alsoChangeEndpoints) {		
					// this test is necessary because this functionality is new, and i wanted to maintain backwards compatibility.
					// this block will only set a connection to be visible if the other endpoint in the connection is also visible.
					var oidx = jpc.sourceId === id ? 1 : 0;
					if (jpc.endpoints[oidx].isVisible()) jpc.setVisible(true);
				}
				else  // the default behaviour for show, and what always happens for hide, is to just set the visibility without getting clever.
					jpc.setVisible(state);
			}, endpointFunc);
		},
		/**
		 * toggles the draggable state of the given element(s).
		 * 
		 * @param el
		 *            either an id, or an element object, or a list of
		 *            ids/element objects.
		 */
		_toggleDraggable = function(el) {
			return _elementProxy(el, function(el, elId) {
				var state = draggableStates[elId] == null ? false : draggableStates[elId];
				state = !state;
				draggableStates[elId] = state;
				jsPlumb.CurrentLibrary.setDraggable(el, state);
				return state;
			});
		},
		/**
		 * private method to do the business of toggling hiding/showing.
		 * 
		 * @param elId
		 *            Id of the element in question
		 */
		_toggleVisible = function(elId, changeEndpoints) {
			var endpointFunc = null;
			if (changeEndpoints) {
				endpointFunc = function(ep) {
					var state = ep.isVisible();
					ep.setVisible(!state);
				};
			}
			_operation(elId, function(jpc) {
				var state = jpc.isVisible();
				jpc.setVisible(!state);				
			}, endpointFunc);
			// todo this should call _elementProxy, and pass in the
			// _operation(elId, f) call as a function. cos _toggleDraggable does
			// that.
		},
		/**
		 * updates the offset and size for a given element, and stores the
		 * values. if 'offset' is not null we use that (it would have been
		 * passed in from a drag call) because it's faster; but if it is null,
		 * or if 'recalc' is true in order to force a recalculation, we get the current values.
		 */
		_updateOffset = function(params) {
			var timestamp = params.timestamp, recalc = params.recalc, offset = params.offset, elId = params.elId;
			if (_suspendDrawing && !timestamp) timestamp = _suspendedAt;
			if (!recalc) {
				if (timestamp && timestamp === offsetTimestamps[elId])
					return offsets[elId];
			}
			if (recalc || !offset) { // if forced repaint or no offset available, we recalculate.
				// get the current size and offset, and store them
				var s = _getElementObject(elId);
				if (s != null) {						
					sizes[elId] = _getSize(s);
					offsets[elId] = _getOffset(s, _currentInstance);
					offsetTimestamps[elId] = timestamp;
				}
			} else {
				offsets[elId] = offset;
        if (sizes[elId] == null) {
            var s = _getElementObject(elId);
				    if (s != null) sizes[elId] = _getSize(s);
        }
		}
			
			if(offsets[elId] && !offsets[elId].right) {
				offsets[elId].right = offsets[elId].left + sizes[elId][0];
				offsets[elId].bottom = offsets[elId].top + sizes[elId][1];	
				offsets[elId].width = sizes[elId][0];
				offsets[elId].height = sizes[elId][1];	
				offsets[elId].centerx = offsets[elId].left + (offsets[elId].width / 2);
				offsets[elId].centery = offsets[elId].top + (offsets[elId].height / 2);				
			}
			return offsets[elId];
		},

		// TODO comparison performance
		_getCachedData = function(elId) {
			var o = offsets[elId];
			if (!o) o = _updateOffset({elId:elId});
			return {o:o, s:sizes[elId]};
		},

		/**
		 * gets an id for the given element, creating and setting one if
		 * necessary.  the id is of the form
		 *
		 *	jsPlumb_<instance index>_<index in instance>
		 *
		 * where "index in instance" is a monotonically increasing integer that starts at 0,
		 * for each instance.  this method is used not only to assign ids to elements that do not
		 * have them but also to connections and endpoints.
		 */
		_getId = function(element, uuid, doNotCreateIfNotFound) {
			var ele = _getElementObject(element);
			var id = _getAttribute(ele, "id");
			if (!id || id == "undefined") {
				// check if fixed uuid parameter is given
				if (arguments.length == 2 && arguments[1] != undefined)
					id = uuid;
				else if (arguments.length == 1 || (arguments.length == 3 && !arguments[2]))
					id = "jsPlumb_" + _instanceIndex + "_" + _idstamp();
				
                if (!doNotCreateIfNotFound) _setAttribute(ele, "id", id);
			}
			return id;
		},		

		/**
		 * wraps one function with another, creating a placeholder for the
		 * wrapped function if it was null. this is used to wrap the various
		 * drag/drop event functions - to allow jsPlumb to be notified of
		 * important lifecycle events without imposing itself on the user's
		 * drag/drop functionality. TODO: determine whether or not we should
		 * support an error handler concept, if one of the functions fails.
		 * 
		 * @param wrappedFunction original function to wrap; may be null.
		 * @param newFunction function to wrap the original with.
		 * @param returnOnThisValue Optional. Indicates that the wrappedFunction should 
		 * not be executed if the newFunction returns a value matching 'returnOnThisValue'.
		 * note that this is a simple comparison and only works for primitives right now.
		 */
		_wrap = function(wrappedFunction, newFunction, returnOnThisValue) {
			wrappedFunction = wrappedFunction || function() { };
			newFunction = newFunction || function() { };
			return function() {
				var r = null;
				try {
					r = newFunction.apply(this, arguments);
				} catch (e) {
					_log(_currentInstance, "jsPlumb function failed : " + e);
				}
				if (returnOnThisValue == null || (r !== returnOnThisValue)) {
					try {
						wrappedFunction.apply(this, arguments);
					} catch (e) {
						_log(_currentInstance, "wrapped function failed : " + e);
					}
				}
				return r;
			};
		};	

		/*
		 * Property: connectorClass 
		 *   The CSS class to set on Connection elements. This value is a String and can have multiple classes; the entire String is appended as-is.
		 */
		this.connectorClass = "_jsPlumb_connector";

		/*
		 * Property: endpointClass 
		 *   The CSS class to set on Endpoint elements. This value is a String and can have multiple classes; the entire String is appended as-is.
		 */
		this.endpointClass = "_jsPlumb_endpoint";

		/*
		 * Property: overlayClass 
		 * The CSS class to set on an Overlay that is an HTML element. This value is a String and can have multiple classes; the entire String is appended as-is.
		 */
		this.overlayClass = "_jsPlumb_overlay";
		
		this.Anchors = {};
		
		this.Connectors = { 
			"canvas":{},
			"svg":{},
			"vml":{}
		};

		this.Endpoints = {
			"canvas":{},
			"svg":{},
			"vml":{}
		};

		this.Overlays = {
			"canvas":{},
			"svg":{},
			"vml":{}
		};
		
// ************************ PLACEHOLDER DOC ENTRIES FOR NATURAL DOCS *****************************************
		/*
		 * Function: bind
		 * Bind to an event on jsPlumb.  
		 * 
		 * Parameters:
		 * 	event - the event to bind.  Available events on jsPlumb are:
		 *         - *jsPlumbConnection* 			: 	notification that a new Connection was established.  jsPlumb passes the new Connection to the callback.
		 *         - *jsPlumbConnectionDetached* 	: 	notification that a Connection was detached.  jsPlumb passes the detached Connection to the callback.
		 *         - *click*						:	notification that a Connection was clicked.  jsPlumb passes the Connection that was clicked to the callback.
		 *         - *dblclick*						:	notification that a Connection was double clicked.  jsPlumb passes the Connection that was double clicked to the callback.
		 *         - *endpointClick*				:	notification that an Endpoint was clicked.  jsPlumb passes the Endpoint that was clicked to the callback.
		 *         - *endpointDblClick*				:	notification that an Endpoint was double clicked.  jsPlumb passes the Endpoint that was double clicked to the callback.
		 *         - *beforeDrop*					: 	notification that a Connection is about to be dropped. Returning false from this method cancels the drop. jsPlumb passes { sourceId, targetId, scope, connection, dropEndpoint } to your callback. For more information, refer to the jsPlumb documentation.
		 *         - *beforeDetach*					: 	notification that a Connection is about to be detached. Returning false from this method cancels the detach. jsPlumb passes the Connection to your callback. For more information, refer to the jsPlumb documentation.
		 *		   - *connectionDrag* 				:   notification that an existing Connection is being dragged. jsPlumb passes the Connection to your callback function.
		 *         - *connectionDragEnd*            :   notification that the drag of an existing Connection has ended.  jsPlumb passes the Connection to your callback function.
		 *         
		 *  callback - function to callback. This function will be passed the Connection/Endpoint that caused the event, and also the original event.    
		 */
		
		/*
		 * Function: unbind
		 * Clears either all listeners, or listeners for some specific event.
		 * 
		 * Parameters:
		 * 	event	-	optional. constrains the clear to just listeners for this event.
		 */				
		
// *************** END OF PLACEHOLDER DOC ENTRIES FOR NATURAL DOCS ***********************************************************		
		

// --------------------------- jsPLumbInstance public API ---------------------------------------------------------

		/*
		 Function: addClass
		 
		 Helper method to abstract out differences in setting css classes on the different renderer types.
		*/
		this.addClass = function(el, clazz) {
			return jsPlumb.CurrentLibrary.addClass(el, clazz);
		};
		
		/*
		 Function: removeClass
		 
		 Helper method to abstract out differences in setting css classes on the different renderer types.
		*/
		this.removeClass = function(el, clazz) {
			return jsPlumb.CurrentLibrary.removeClass(el, clazz);
		};
		
		/*
		 Function: hasClass
		 
		 Helper method to abstract out differences in testing for css classes on the different renderer types.
		*/
		this.hasClass = function(el, clazz) {
			return jsPlumb.CurrentLibrary.hasClass(el, clazz);
		};
		
		/*
		  Function: addEndpoint 
		  	
		  Adds an <Endpoint> to a given element or elements.
		  			  
		  Parameters:
		   
		  	el - Element to add the endpoint to. Either an element id, a selector representing some element(s), or an array of either of these. 
		  	params - Object containing Endpoint constructor arguments.  For more information, see <Endpoint>.
		  	referenceParams - Object containing more Endpoint constructor arguments; it will be merged with params by jsPlumb.  You would use this if you had some 
		  					  shared parameters that you wanted to reuse when you added Endpoints to a number of elements. The allowed values in
		  					  this object are anything that 'params' can contain.  See <Endpoint>.
		  	 
		  Returns: 
		  	The newly created <Endpoint>, if el referred to a single element.  Otherwise, an array of newly created <Endpoint>s. 
		  	
		  See Also: 
		  	<addEndpoints>
		 */
		this.addEndpoint = function(el, params, referenceParams) {
			referenceParams = referenceParams || {};
			var p = jsPlumb.extend({}, referenceParams);
			jsPlumb.extend(p, params);
			p.endpoint = p.endpoint || _currentInstance.Defaults.Endpoint || jsPlumb.Defaults.Endpoint;
			p.paintStyle = p.paintStyle || _currentInstance.Defaults.EndpointStyle || jsPlumb.Defaults.EndpointStyle;
            // YUI wrapper
			el = _convertYUICollection(el);			
			
			var results = [], inputs = el.length && el.constructor != String ? el : [ el ];
						
			for (var i = 0; i < inputs.length; i++) {
				var _el = _getElementObject(inputs[i]), id = _getId(_el);
				p.source = _el;
                _updateOffset({ elId : id, timestamp:_suspendedAt });
				var e = _newEndpoint(p);
				if (p.parentAnchor) e.parentAnchor = p.parentAnchor;
				_addToList(endpointsByElement, id, e);
				var myOffset = offsets[id], myWH = sizes[id];
				var anchorLoc = e.anchor.compute( { xy : [ myOffset.left, myOffset.top ], wh : myWH, element : e, timestamp:_suspendedAt });
				var endpointPaintParams = { anchorLoc : anchorLoc, timestamp:_suspendedAt };
				if (_suspendDrawing) endpointPaintParams.recalc = false;
				e.paint(endpointPaintParams);
				results.push(e);
				//if (!jsPlumbAdapter.headless)
					//_currentInstance.dragManager.endpointAdded(_el);
			}
			
			return results.length == 1 ? results[0] : results;
		};
		
		/*
		  Function: addEndpoints 
		  Adds a list of <Endpoint>s to a given element or elements.
		  
		  Parameters: 
		  	target - element to add the Endpoint to. Either an element id, a selector representing some element(s), or an array of either of these. 
		  	endpoints - List of objects containing Endpoint constructor arguments. one Endpoint is created for each entry in this list.  See <Endpoint>'s constructor documentation. 
			referenceParams - Object containing more Endpoint constructor arguments; it will be merged with params by jsPlumb.  You would use this if you had some shared parameters that you wanted to reuse when you added Endpoints to a number of elements.		  	 

		  Returns: 
		  	List of newly created <Endpoint>s, one for each entry in the 'endpoints' argument. 
		  	
		  See Also:
		  	<addEndpoint>
		 */
		this.addEndpoints = function(el, endpoints, referenceParams) {
			var results = [];
			for ( var i = 0; i < endpoints.length; i++) {
				var e = _currentInstance.addEndpoint(el, endpoints[i], referenceParams);
				if (_isArray(e))
					Array.prototype.push.apply(results, e);
				else results.push(e);
			}
			return results;
		};

		/*
		  Function: animate 
		  This is a wrapper around the supporting library's animate function; it injects a call to jsPlumb in the 'step' function (creating
		  the 'step' function if necessary). This only supports the two-arg version of the animate call in jQuery, the one that takes an 'options' object as
		  the second arg. MooTools has only one method, a two arg one. Which is handy.  YUI has a one-arg method, so jsPlumb merges 'properties' and 'options' together for YUI.
		   
		  Parameters: 
		  	el - Element to animate. Either an id, or a selector representing the element. 
		  	properties - The 'properties' argument you want passed to the library's animate call. 
		   	options - The 'options' argument you want passed to the library's animate call.
		    
		  Returns: 
		  	void
		 */
		this.animate = function(el, properties, options) {
			var ele = _getElementObject(el), id = _getAttribute(el, "id");
			options = options || {};
			var stepFunction = jsPlumb.CurrentLibrary.dragEvents['step'];
			var completeFunction = jsPlumb.CurrentLibrary.dragEvents['complete'];
			options[stepFunction] = _wrap(options[stepFunction], function() {
				_currentInstance.repaint(id);
			});

			// onComplete repaints, just to make sure everything looks good at the end of the animation.
			options[completeFunction] = _wrap(options[completeFunction],
					function() {
						_currentInstance.repaint(id);
					});

			jsPlumb.CurrentLibrary.animate(ele, properties, options);
		};		
		
		/**
		* checks for a listener for the given condition, executing it if found, passing in the given value.
		* condition listeners would have been attached using "bind" (which is, you could argue, now overloaded, since
		* firing click events etc is a bit different to what this does).  i thought about adding a "bindCondition"
		* or something, but decided against it, for the sake of simplicity. jsPlumb will never fire one of these
		* condition events anyway.
		*/
		this.checkCondition = function(conditionName, value) {
			var l = _currentInstance.getListener(conditionName);
			var r = true;
			if (l && l.length > 0) {
				try {
					for (var i = 0 ; i < l.length; i++) {
						r = r && l[i](value); 
					}
				}
				catch (e) { 
					_log(_currentInstance, "cannot check condition [" + conditionName + "]" + e); 
				}
			}
			return r;
		};

		/*
		  Function: connect 
		  Establishes a <Connection> between two elements (or <Endpoint>s, which are themselves registered to elements).
		  
		  Parameters: 
		    params - Object containing constructor arguments for the Connection. See <Connection>'s constructor documentation.
		    referenceParams - Optional object containing more constructor arguments for the Connection. Typically you would pass in data that a lot of 
		    Connections are sharing here, such as connector style etc, and then use the main params for data specific to this Connection.
		     
		  Returns: 
		  	The newly created <Connection>.
		 */
		this.connect = function(params, referenceParams) {
			// prepare a final set of parameters to create connection with
			var _p = _prepareConnectionParams(params, referenceParams), jpc;
			// TODO probably a nicer return value if the connection was not made.  _prepareConnectionParams
			// will return null (and log something) if either endpoint was full.  what would be nicer is to 
			// create a dedicated 'error' object.
			if (_p) {
				// a connect call will delete its created endpoints on detach, unless otherwise specified.
				// this is because the endpoints belong to this connection only, and are no use to
				// anyone else, so they hang around like a bad smell.
				if (_p.deleteEndpointsOnDetach == null)
					_p.deleteEndpointsOnDetach = true;

				// create the connection.  it is not yet registered 
				jpc = _newConnection(_p);
				// now add it the model, fire an event, and redraw
				_finaliseConnection(jpc, _p);										
			}
			return jpc;
		};
		
		/*
		 Function: deleteEndpoint		 
		 Deletes an Endpoint and removes all Connections it has (which removes the Connections from the other Endpoints involved too)
		 
		 Parameters:
		 	object - either an <Endpoint> object (such as from an addEndpoint call), or a String UUID.
		 	
		 Returns:
		 	void		  
		 */
		this.deleteEndpoint = function(object) {
			var endpoint = (typeof object == "string") ? endpointsByUUID[object] : object;			
			if (endpoint) {					
				var uuid = endpoint.getUuid();
				if (uuid) endpointsByUUID[uuid] = null;				
				endpoint.detachAll();
				if (endpoint.endpoint.cleanup) endpoint.endpoint.cleanup();
				_removeElements(endpoint.endpoint.getDisplayElements());
				_currentInstance.anchorManager.deleteEndpoint(endpoint);
				for (var e in endpointsByElement) {
					var endpoints = endpointsByElement[e];
					if (endpoints) {
						var newEndpoints = [];
						for (var i = 0; i < endpoints.length; i++)
							if (endpoints[i] != endpoint) newEndpoints.push(endpoints[i]);
						
						endpointsByElement[e] = newEndpoints;
					}
				}
				if (!jsPlumbAdapter.headless)
					_currentInstance.dragManager.endpointDeleted(endpoint);								
			}									
		};
		
		/*
		 Function: deleteEveryEndpoint
		  Deletes every <Endpoint>, and their associated <Connection>s, in this instance of jsPlumb. Does not unregister any event listeners (this is the only difference
between this method and jsPlumb.reset).  
		  
		 Returns: 
		 	void 
		 */
		this.deleteEveryEndpoint = function() {
			_currentInstance.setSuspendDrawing(true);
			for ( var id in endpointsByElement) {
				var endpoints = endpointsByElement[id];
				if (endpoints && endpoints.length) {
					for ( var i = 0; i < endpoints.length; i++) {
						_currentInstance.deleteEndpoint(endpoints[i]);
					}
				}
			}			
			endpointsByElement = {};			
			endpointsByUUID = {};
			
			_currentInstance.setSuspendDrawing(false, true);
		};

		var fireDetachEvent = function(jpc, doFireEvent, originalEvent) {
            // may have been given a connection, or in special cases, an object
            var connType =  _currentInstance.Defaults.ConnectionType || _currentInstance.getDefaultConnectionType(),
                argIsConnection = jpc.constructor == connType,
                params = argIsConnection ? {
                    connection:jpc,
				    source : jpc.source, target : jpc.target,
				    sourceId : jpc.sourceId, targetId : jpc.targetId,
				    sourceEndpoint : jpc.endpoints[0], targetEndpoint : jpc.endpoints[1]
                } : jpc;

			if (doFireEvent) {
				_currentInstance.fire("jsPlumbConnectionDetached", params, originalEvent);
				// introduced in 1.3.11..an alias because the original event name is unwieldy.  in future versions this will be the only event and the other will no longer be fired.
				_currentInstance.fire("connectionDetached", params, originalEvent);
			}
            _currentInstance.anchorManager.connectionDetached(params);
		},
		/**
			fires an event to indicate an existing connection is being dragged.
		*/
		fireConnectionDraggingEvent = function(jpc) {
			_currentInstance.fire("connectionDrag", jpc);	
		},
		fireConnectionDragStopEvent = function(jpc) {
			_currentInstance.fire("connectionDragStop", jpc);
		};

		/*
		  Function: detach 
		  Detaches and then removes a <Connection>.  
		  		   
		  Parameters: 
		    connection  -   the <Connection> to detach
		    params      -   optional parameters to the detach call.  valid values here are
		                    fireEvent   :   defaults to false; indicates you want jsPlumb to fire a connection
		                                    detached event. The thinking behind this is that if you made a programmatic
		                                    call to detach an event, you probably don't need the callback.
		                    forceDetach :   defaults to false. allows you to override any beforeDetach listeners that may be registered.

		    Returns: 
		    	true if successful, false if not.
		 */
		this.detach = function() {

            if (arguments.length == 0) return;
            var connType =  _currentInstance.Defaults.ConnectionType || _currentInstance.getDefaultConnectionType(),
                firstArgIsConnection = arguments[0].constructor == connType,
                params = arguments.length == 2 ? firstArgIsConnection ? (arguments[1] || {}) : arguments[0] : arguments[0],
                fireEvent = (params.fireEvent !== false),
                forceDetach = params.forceDetach,
                connection = firstArgIsConnection ? arguments[0] : params.connection;

				if (connection) {
                    if (forceDetach || (connection.isDetachAllowed(connection)
                                        && connection.endpoints[0].isDetachAllowed(connection)
                                        && connection.endpoints[1].isDetachAllowed(connection))) {
                        if (forceDetach || _currentInstance.checkCondition("beforeDetach", connection))
						    connection.endpoints[0].detach(connection, false, true, fireEvent); // TODO check this param iscorrect for endpoint's detach method
                    }
                }
                else {
					var _p = jsPlumb.extend( {}, params); // a backwards compatibility hack: source should be thought of as 'params' in this case.
					// test for endpoint uuids to detach
					if (_p.uuids) {
						_getEndpoint(_p.uuids[0]).detachFrom(_getEndpoint(_p.uuids[1]), fireEvent);
					} else if (_p.sourceEndpoint && _p.targetEndpoint) {
						_p.sourceEndpoint.detachFrom(_p.targetEndpoint);
					} else {
						var sourceId = _getId(_p.source),
						    targetId = _getId(_p.target);
						_operation(sourceId, function(jpc) {
						    if ((jpc.sourceId == sourceId && jpc.targetId == targetId) || (jpc.targetId == sourceId && jpc.sourceId == targetId)) {
							    if (_currentInstance.checkCondition("beforeDetach", jpc)) {
                                    jpc.endpoints[0].detach(jpc, false, true, fireEvent);
								}
							}
						});
					}
				}
		};

		/*
		  Function: detachAllConnections
		  Removes all an element's Connections.
		   
		  Parameters:
		  	el - either the id of the element, or a selector for the element.
		  	params - optional parameters.  alowed values:
		  	        fireEvent : defaults to true, whether or not to fire the detach event.
		  	
		  Returns: 
		  	void
		 */
		this.detachAllConnections = function(el, params) {
            params = params || {};
            el = _getElementObject(el);
			var id = _getAttribute(el, "id"),
                endpoints = endpointsByElement[id];
			if (endpoints && endpoints.length) {
				for ( var i = 0; i < endpoints.length; i++) {
					endpoints[i].detachAll(params.fireEvent);
				}
			}
		};

		/*
		  Function: detachEveryConnection 
		  Remove all Connections from all elements, but leaves Endpoints in place.

		  Parameters:
		    params  - optional params object containing:
		            fireEvent : whether or not to fire detach events. defaults to true.

		   
		  Returns: 
		  	void
		  	 
		  See Also:
		  	<removeEveryEndpoint>
		 */
		this.detachEveryConnection = function(params) {
            params = params || {};
			for ( var id in endpointsByElement) {
				var endpoints = endpointsByElement[id];
				if (endpoints && endpoints.length) {
					for ( var i = 0; i < endpoints.length; i++) {
						endpoints[i].detachAll(params.fireEvent);
					}
				}
			}
			connectionsByScope = {};
		};


		/*
		  Function: draggable 
		  Initialises the draggability of some element or elements.  You should use this instead of your 
		  library's draggable method so that jsPlumb can setup the appropriate callbacks.  Your 
		  underlying library's drag method is always called from this method.
		  
		  Parameters: 
		  	el - either an element id, a list of element ids, or a selector. 
		  	options - options to pass through to the underlying library
		  	 
		  Returns: 
		  	void
		 */		 
		this.draggable = function(el, options) {
			if (typeof el == 'object' && el.length) {
				for ( var i = 0; i < el.length; i++) {
					var ele = _getElementObject(el[i]);
					if (ele) _initDraggableIfNecessary(ele, true, options);
				}
			} 
			else if (el._nodes) { 	// TODO this is YUI specific; really the logic should be forced
				// into the library adapters (for jquery and mootools aswell)
				for ( var i = 0; i < el._nodes.length; i++) {
					var ele = _getElementObject(el._nodes[i]);
					if (ele) _initDraggableIfNecessary(ele, true, options);
				}
			}
			else {
				var ele = _getElementObject(el);
				if (ele) _initDraggableIfNecessary(ele, true, options);
			}
		};

		/*
		  Function: extend 
		  Wraps the underlying library's extend functionality.
		  
		  Parameters: 
		  	o1 - object to extend 
		  	o2 - object to extend o1 with
		  	
		  Returns: 
		  	o1, extended with all properties from o2.
		 */
		this.extend = function(o1, o2) {
			return jsPlumb.CurrentLibrary.extend(o1, o2);
		};
		
		/*
		 * Function: getDefaultEndpointType
		 * 	Returns the default Endpoint type. Used when someone wants to subclass Endpoint and have jsPlumb return instances of their subclass.
		 *  you would make a call like this in your class's constructor:
		 *    jsPlumb.getDefaultEndpointType().apply(this, arguments);
		 * 
		 * Returns:
		 * 	the default Endpoint function used by jsPlumb.
		 */
		this.getDefaultEndpointType = function() {
			return Endpoint;
		};
		
		/*
		 * Function: getDefaultConnectionType
		 * 	Returns the default Connection type. Used when someone wants to subclass Connection and have jsPlumb return instances of their subclass.
		 *  you would make a call like this in your class's constructor:
		 *    jsPlumb.getDefaultConnectionType().apply(this, arguments);
		 * 
		 * Returns:
		 * 	the default Connection function used by jsPlumb.
		 */
		this.getDefaultConnectionType = function() {
			return Connection;
		};

		// helpers for select/selectEndpoints
		var _setOperation = function(list, func, args, selector) {
				for (var i = 0; i < list.length; i++) {
					list[i][func].apply(list[i], args);
				}	
				return selector(list);
			},
			_getOperation = function(list, func, args) {
				var out = [];
				for (var i = 0; i < list.length; i++) {					
					out.push([ list[i][func].apply(list[i], args), list[i] ]);
				}	
				return out;
			},
			setter = function(list, func, selector) {
				return function() {
					return _setOperation(list, func, arguments, selector);
				};
			},
			getter = function(list, func) {
				return function() {
					return _getOperation(list, func, arguments);
				};	
			},
			prepareList = function(input, doNotGetIds) {
				var r = [];
				if (input) {
					if (typeof input == 'string') {
						if (input === "*") return input;
						r.push(input);
					}
					else {
						if (doNotGetIds) r = input;
						else { 
							for (var i = 0; i < input.length; i++) 
								r.push(_getId(_getElementObject(input[i])));
						}	
					}
				}
				return r;
			},
			filterList = function(list, value, missingIsFalse) {
				if (list === "*") return true;
				return list.length > 0 ? _indexOf(list, value) != -1 : !missingIsFalse;
			};

		/*
		 * Function: getConnections 
		 * Gets all or a subset of connections currently managed by this jsPlumb instance.  If only one scope is passed in to this method,
		 * the result will be a list of connections having that scope (passing in no scope at all will result in jsPlumb assuming you want the
		 * default scope).  If multiple scopes are passed in, the return value will be a map of { scope -> [ connection... ] }.
		 * 
		 *  Parameters:
		 *  	scope	-	if the only argument to getConnections is a string, jsPlumb will treat that string as a scope filter, and return a list
		 *                  of connections that are in the given scope. use '*' for all scopes.
		 *      options	-	if the argument is a JS object, you can specify a finer-grained filter:
		 *      
		 *      		-	*scope* may be a string specifying a single scope, or an array of strings, specifying multiple scopes. Also may have the value '*', indicating any scope.
		 *      		-	*source* either a string representing an element id, a selector, or an array of ids. Also may have the value '*', indicating any source.  Constrains the result to connections having this/these element(s) as source.
		 *      		-	*target* either a string representing an element id, a selector, or an array of ids. Also may have the value '*', indicating any target.  Constrains the result to connections having this/these element(s) as target.		 
		 *		flat    -	return results in a flat array (don't return an object whose keys are scopes and whose values are lists per scope).
		 * 
		 */
		this.getConnections = function(options, flat) {
			if (!options) {
				options = {};
			} else if (options.constructor == String) {
				options = { "scope": options };
			}
			var
			scope = options.scope || _currentInstance.getDefaultScope(),
			scopes = prepareList(scope, true),
			sources = prepareList(options.source),
			targets = prepareList(options.target),			
			results = (!flat && scopes.length > 1) ? {} : [],
			_addOne = function(scope, obj) {
				if (!flat && scopes.length > 1) {
					var ss = results[scope];
					if (ss == null) {
						ss = []; results[scope] = ss;
					}
					ss.push(obj);
				} else results.push(obj);
			};
			for ( var i in connectionsByScope) {
				if (filterList(scopes, i)) {
					for ( var j = 0; j < connectionsByScope[i].length; j++) {
						var c = connectionsByScope[i][j];
						if (filterList(sources, c.sourceId) && filterList(targets, c.targetId))
							_addOne(i, c);
					}
				}
			}
			return results;
		};
		
		var _curryEach = function(list, executor) {
				return function(f) {
					for (var i = 0; i < list.length; i++) {
						f(list[i]);
					}
					return executor(list);
				};		
			},
			_curryGet = function(list) {
				return function(idx) {
					return list[idx];
				};
			};
			
		var _makeCommonSelectHandler = function(list, executor) {
			return {
				// setters
				setHover:setter(list, "setHover", executor),								
				removeAllOverlays:setter(list, "removeAllOverlays", executor),
				setLabel:setter(list, "setLabel", executor),
				addOverlay:setter(list, "addOverlay", executor),
				removeOverlay:setter(list, "removeOverlay", executor),
				removeOverlays:setter(list, "removeOverlays", executor),
				showOverlay:setter(list, "showOverlay", executor),
				hideOverlay:setter(list, "hideOverlay", executor),
				showOverlays:setter(list, "showOverlays", executor),
				hideOverlays:setter(list, "hideOverlays", executor),
				setPaintStyle:setter(list, "setPaintStyle", executor),
				setHoverPaintStyle:setter(list, "setHoverPaintStyle", executor),									
				setParameter:setter(list, "setParameter", executor),		
				setParameters:setter(list, "setParameters", executor),
				setVisible:setter(list, "setVisible", executor),
				setZIndex:setter(list, "setZIndex", executor),
				repaint:setter(list, "repaint", executor),
				addType:setter(list, "addType", executor),
				toggleType:setter(list, "toggleType", executor),
				removeType:setter(list, "removeType", executor),

				// getters
				getLabel:getter(list, "getLabel"),
				getOverlay:getter(list, "getOverlay"),
				isHover:getter(list, "isHover"),
				getParameter:getter(list, "getParameter"),		
				getParameters:getter(list, "getParameters"),
				getPaintStyle:getter(list, "getPaintStyle"),		
				getHoverPaintStyle:getter(list, "getHoverPaintStyle"),
				isVisible:getter(list, "isVisible"),
				getZIndex:getter(list, "getZIndex"),
				hasType:getter(list, "hasType"),
				getType:getter(list, "getType"),

				// util
				length:list.length,
				each:_curryEach(list, executor),
				get:_curryGet(list)
			};
		
		};
		
		var	_makeConnectionSelectHandler = function(list) {
			var common = _makeCommonSelectHandler(list, _makeConnectionSelectHandler);
			return jsPlumb.CurrentLibrary.extend(common, {
				// setters									
				setDetachable:setter(list, "setDetachable", _makeConnectionSelectHandler),
				setReattach:setter(list, "setReattach", _makeConnectionSelectHandler),
				setConnector:setter(list, "setConnector", _makeConnectionSelectHandler),			
				detach:function() {
					for (var i = 0; i < list.length; i++)
						_currentInstance.detach(list[i]);
				},				
				// getters
				isDetachable:getter(list, "isDetachable"),
				isReattach:getter(list, "isReattach")
			});
		};
		
		var	_makeEndpointSelectHandler = function(list) {
			var common = _makeCommonSelectHandler(list, _makeEndpointSelectHandler);
			return jsPlumb.CurrentLibrary.extend(common, {
				setEnabled:setter(list, "setEnabled", _makeEndpointSelectHandler),
				isEnabled:getter(list, "isEnabled"),
				detachAll:function() {
					for (var i = 0; i < list.length; i++)
						list[i].detachAll();
				},
				"delete":function() {
					for (var i = 0; i < list.length; i++)
						_currentInstance.deleteEndpoint(list[i]);
				}
			});
		};
			
		/*
		* Function: select
		* Selects a set of Connections, using the filter options from the getConnections method, and returns an object
		* that allows you to perform an operation on all of the Connections at once. The return value from any of these 
		* operations is the original list of Connections, allowing operations to be chained (for 'setter' type operations).
		* 'getter' type operations return an array of values, where each entry is a [Connection, return value] pair.
		* 
		* Parameters:
		*	scope - see getConnections
		* 	source - see getConnections
		*	target - see getConnections
		*
		* Returns:
		* A list of Connections on which operations may be executed. 'Setter' type operations can be chained; 'getter' type operations
		* return an array of [Connection, value] pairs, one entry for each Connection in the list returned. The full list of operations 
		* is as follows (where not specified, the operation's effect or return value is the same as the corresponding method on Connection) :
		*	-	setHover								
		*	-	removeAllOverlays
		*	-	setLabel
		*	-	addOverlay
		*	-	removeOverlay
		*	-	removeOverlays
		*	-	showOverlay
		*	-	hideOverlay
		*	-	showOverlays
		*	-	hideOverlays
		*	-	setPaintStyle
		*	-	setHoverPaintStyle
		*	-	setDetachable
		*	-	setConnector
		*	-	setParameter
		*	-	setParameters
		*   - 	getLabel
		*	-	getOverlay
		*	-	isHover
		*	-	isDetachable
		*	-	getParameter
		*	-	getParameters
		*	-	getPaintStyle
		*	-	getHoverPaintStyle
		*	-	detach detaches all the connections in the list. not chainable and does not return anything.
		*	-	length : returns the length of the list.
		*	-	get(index) : returns the Connection at 'index' in the list.
		*	-	each(function(connection)...) : allows you to specify your own function to execute; this function is chainable.
		*/
		this.select = function(params) {
			params = params || {};
			params.scope = params.scope || "*";
			var c = _currentInstance.getConnections(params, true);
			return _makeConnectionSelectHandler(c);							
		};
		
		/*
		* Function: selectEndpoints
		* Selects a set of Endpoints and returns an object that allows you to execute various different methods on them at once. The return 
		* value from any of these operations is the original list of Endpoints, allowing operations to be chained (for 'setter' type 
		* operations). 'getter' type operations return an array of values, where each entry is an [Endpoint, return value] pair.
		* 
		* Parameters:
		*	scope - either a string or an array of strings.
		* 	source - either a string, a dom element, or a selector, or an array of any mix of these. limits returned endpoints to those that are declared as a source endpoint on any elements identified.
		*	target - either a string, a dom element, or a selector, or an array of any mix of these. limits returned endpoints to those that are declared as a target endpoint on any elements identified.
		*	element - either a string, a dom element, or a selector, or an array of any mix of these. limits returned endpoints to those that are declared as either a source OR a target endpoint on any elements identified.		
		*
		* Returns:
		* A list of Endpoints on which operations may be executed. 'Setter' type operations can be chained; 'getter' type operations
		* return an array of [Endpoint, value] pairs, one entry for each Endpoint in the list returned. The full list of operations 
		* is as follows (where not specified, the operation's effect or return value is the same as the corresponding method on Endpoint) :
		*	-	setHover								
		*	-	removeAllOverlays
		*	-	setLabel
		*	-	addOverlay
		*	-	removeOverlay
		*	-	removeOverlays
		*	-	showOverlay
		*	-	hideOverlay
		*	-	showOverlays
		*	-	hideOverlays
		*	-	setPaintStyle
		*	-	setHoverPaintStyle
		*	-	setParameter
		*	-	setParameters
		*   - 	getLabel
		*	-	getOverlay
		*	-	isHover
		*	-	isDetachable
		*	-	getParameter
		*	-	getParameters
		*	-	getPaintStyle
		*	-	getHoverPaintStyle
		*	-	detachAll Detaches all the Connections from every Endpoint in the list. not chainable and does not return anything.
		*	-	delete Deletes every Endpoint in the list. not chainable and does not return anything.		
		*	-	length : returns the length of the list.
		*	-	get(index) : returns the Endpoint at 'index' in the list.
		*	-	each(function(endpoint)...) : allows you to specify your own function to execute; this function is chainable.
		*/
		this.selectEndpoints = function(params) {
			params = params || {};
			params.scope = params.scope || "*";
			var noElementFilters = !params.element && !params.source && !params.target,			
				elements = noElementFilters ? "*" : prepareList(params.element),
				sources = noElementFilters ? "*" : prepareList(params.source),
				targets = noElementFilters ? "*" : prepareList(params.target),
				scopes = prepareList(params.scope, true);
			
			var ep = [];
			
			for (var el in endpointsByElement) {
				var either = filterList(elements, el, true),
					source = filterList(sources, el, true),
					sourceMatchExact = sources != "*",
					target = filterList(targets, el, true),
					targetMatchExact = targets != "*"; 
					
				// if they requested 'either' then just match scope. otherwise if they requested 'source' (not as a wildcard) then we have to match only endpoints that have isSource set to to true, and the same thing with isTarget.  
				if ( either || source  || target ) {
					inner:
					for (var i = 0; i < endpointsByElement[el].length; i++) {
						var _ep = endpointsByElement[el][i];
						if (filterList(scopes, _ep.scope, true)) {
						
							var noMatchSource = (sourceMatchExact && sources.length > 0 && !_ep.isSource),
								noMatchTarget = (targetMatchExact && targets.length > 0 && !_ep.isTarget);
						
							if (noMatchSource || noMatchTarget)								  
								  continue inner; 
							 							
							ep.push(_ep);		
						}
					}
				}					
			}
			
			return _makeEndpointSelectHandler(ep);
		};

		/*
		 * Function: getAllConnections
		 * Gets all connections, as a map of { scope -> [ connection... ] }. 
		 */
		this.getAllConnections = function() {
			return connectionsByScope;
		};

		/*
		 * Function: getDefaultScope 
		 * Gets the default scope for connections and  endpoints. a scope defines a type of endpoint/connection; supplying a
		 * scope to an endpoint or connection allows you to support different
		 * types of connections in the same UI. but if you're only interested in
		 * one type of connection, you don't need to supply a scope. this method
		 * will probably be used by very few people; it's good for testing
		 * though.
		 */
		this.getDefaultScope = function() {
			return DEFAULT_SCOPE;
		};

		/*
		  Function: getEndpoint 
		  Gets an Endpoint by UUID
		   
		  Parameters: 
		  	uuid - the UUID for the Endpoint
		  	 
		  Returns: 
		  	Endpoint with the given UUID, null if nothing found.
		 */
		this.getEndpoint = _getEndpoint;
				
		/**
		 * Function:getEndpoints
		 * Gets the list of Endpoints for a given selector, or element id.
		 * @param el
		 * @return
		 */
		this.getEndpoints = function(el) {
			return endpointsByElement[_getId(el)];
		};		

		/*
		 * Gets an element's id, creating one if necessary. really only exposed
		 * for the lib-specific functionality to access; would be better to pass
		 * the current instance into the lib-specific code (even though this is
		 * a static call. i just don't want to expose it to the public API).
		 */
		this.getId = _getId;
		this.getOffset = function(id) { 
			var o = offsets[id]; 
			return _updateOffset({elId:id});
		};
		
		this.getSelector = function(spec) {
			return jsPlumb.CurrentLibrary.getSelector(spec);
		};
		
		this.getSize = function(id) { 
			var s = sizes[id]; 
			if (!s) _updateOffset({elId:id});
			return sizes[id];
		};		
		
		this.appendElement = _appendElement;
		
		var _hoverSuspended = false;
		this.isHoverSuspended = function() { return _hoverSuspended; };
		this.setHoverSuspended = function(s) { _hoverSuspended = s; };

		var _isAvailable = function(m) {
			return function() {
				return jsPlumbAdapter.isRenderModeAvailable(m);
			};
		}
		this.isCanvasAvailable = _isAvailable("canvas");
		this.isSVGAvailable = _isAvailable("svg");
		this.isVMLAvailable = _isAvailable("vml");

		/*
		  Function: hide 
		  Sets an element's connections to be hidden.
		  
		  Parameters: 
		  	el - either the id of the element, or a selector for the element.
		  	changeEndpoints - whether not to also hide endpoints on the element. by default this is false.  
		  	 
		  Returns: 
		  	void
		 */
		this.hide = function(el, changeEndpoints) {
			_setVisible(el, "none", changeEndpoints);
		};
		
		// exposed for other objects to use to get a unique id.
		this.idstamp = _idstamp;
		
		/**
		 * callback from the current library to tell us to prepare ourselves (attach
		 * mouse listeners etc; can't do that until the library has provided a bind method)
		 * @return
		 */
		this.init = function() {
			if (!initialized) {
				_currentInstance.setRenderMode(_currentInstance.Defaults.RenderMode);  // calling the method forces the capability logic to be run.
				
				var bindOne = function(event) {
						jsPlumb.CurrentLibrary.bind(document, event, function(e) {
							if (!_currentInstance.currentlyDragging && renderMode == jsPlumb.CANVAS) {
								// try connections first
								for (var scope in connectionsByScope) {
					    			var c = connectionsByScope[scope];
					    			for (var i = 0; i < c.length; i++) {
					    				var t = c[i].connector[event](e);
					    				if (t) return;	
					    			}
					    		}
								for (var el in endpointsByElement) {
									var ee = endpointsByElement[el];
									for (var i = 0; i < ee.length; i++) {
										if (ee[i].endpoint[event](e)) return;
									}
								}
							}
						});					
				};
				bindOne("click");bindOne("dblclick");bindOne("mousemove");bindOne("mousedown");bindOne("mouseup");bindOne("contextmenu");
			
				initialized = true;
				_currentInstance.fire("ready");
			}
		};
		
		this.log = log;
		this.jsPlumbUIComponent = jsPlumbUIComponent;		

		/*
		 * Creates an anchor with the given params.
		 * 
		 * 
		 * Returns: The newly created Anchor.
		 */
		this.makeAnchor = function() {
			if (arguments.length == 0) return null;
			var specimen = arguments[0], elementId = arguments[1], jsPlumbInstance = arguments[2], newAnchor = null;			
			// if it appears to be an anchor already...
			if (specimen.compute && specimen.getOrientation) return specimen;  //TODO hazy here about whether it should be added or is already added somehow.
			// is it the name of an anchor type?
			else if (typeof specimen == "string") {
				newAnchor = jsPlumb.Anchors[arguments[0]]({elementId:elementId, jsPlumbInstance:_currentInstance});
			}
			// is it an array? it will be one of:
			// 		an array of [name, params] - this defines a single anchor
			//		an array of arrays - this defines some dynamic anchors
			//		an array of numbers - this defines a single anchor.				
			else if (_isArray(specimen)) {
				if (_isArray(specimen[0]) || _isString(specimen[0])) {
					if (specimen.length == 2 && _isString(specimen[0]) && _isObject(specimen[1])) {
						var pp = jsPlumb.extend({elementId:elementId, jsPlumbInstance:_currentInstance}, specimen[1]);
						newAnchor = jsPlumb.Anchors[specimen[0]](pp);
					}
					else
						newAnchor = new DynamicAnchor(specimen, null, elementId);
				}
				else {
					var anchorParams = {
						x:specimen[0], y:specimen[1],
						orientation : (specimen.length >= 4) ? [ specimen[2], specimen[3] ] : [0,0],
						offsets : (specimen.length == 6) ? [ specimen[4], specimen[5] ] : [ 0, 0 ],
						elementId:elementId
					};						
					newAnchor = new Anchor(anchorParams);
					newAnchor.clone = function() { return new Anchor(anchorParams); };						 					
				}
			}
			
			if (!newAnchor.id) newAnchor.id = "anchor_" + _idstamp();
			return newAnchor;
		};

		/**
		 * makes a list of anchors from the given list of types or coords, eg
		 * ["TopCenter", "RightMiddle", "BottomCenter", [0, 1, -1, -1] ]
		 */
		this.makeAnchors = function(types, elementId, jsPlumbInstance) {
			var r = [];
			for ( var i = 0; i < types.length; i++) {
				if (typeof types[i] == "string")
					r.push(jsPlumb.Anchors[types[i]]({elementId:elementId, jsPlumbInstance:jsPlumbInstance}));
				else if (_isArray(types[i]))
					r.push(_currentInstance.makeAnchor(types[i], elementId, jsPlumbInstance));
			}
			return r;
		};

		/**
		 * Makes a dynamic anchor from the given list of anchors (which may be in shorthand notation as strings or dimension arrays, or Anchor
		 * objects themselves) and the given, optional, anchorSelector function (jsPlumb uses a default if this is not provided; most people will
		 * not need to provide this - i think). 
		 */
		this.makeDynamicAnchor = function(anchors, anchorSelector) {
			return new DynamicAnchor(anchors, anchorSelector);
		};
		
		/**
		 * Function: makeTarget
		 * Makes some DOM element a Connection target, allowing you to drag connections to it
		 * without having to register any Endpoints on it first.  When a Connection is established,
		 * the endpoint spec that was passed in to this method is used to create a suitable 
		 * Endpoint (the default will be used if you do not provide one).
		 * 
		 * Parameters:
		 *  el		-	string id or element selector for the element to make a target.
		 * 	params	-	JS object containing parameters:
		 * 	  endpoint	optional.	specification of an endpoint to create when a connection is created.
		 * 	  scope		optional.   scope for the drop zone.
		 * 	  dropOptions optional. same stuff as you would pass to dropOptions of an Endpoint definition.
		 * 	  deleteEndpointsOnDetach  optional, defaults to true. whether or not to delete
		 *                             any Endpoints created by a connection to this target if
		 *                             the connection is subsequently detached. this will not 
		 *                             remove Endpoints that have had more Connections attached
		 *                             to them after they were created.
		 *   maxConnections  optional. Specifies the maximum number of Connections that can be made to this element as a target. Default is no limit.
		 *   onMaxConnections optional. Function to call when user attempts to drop a connection but the limit has been reached.  The callback is passed two arguments: a JS object with { element, connection, maxConnection }, and the original event.
		 *                   	
		 * 
		 */
		var _targetEndpointDefinitions = {},
			_targetEndpoints = {},
			_targetEndpointsUnique = {},
			_targetMaxConnections = {},
			_setEndpointPaintStylesAndAnchor = function(ep, epIndex) {
				ep.paintStyle = ep.paintStyle ||
				 				_currentInstance.Defaults.EndpointStyles[epIndex] ||
	                            _currentInstance.Defaults.EndpointStyle ||
	                            jsPlumb.Defaults.EndpointStyles[epIndex] ||
	                            jsPlumb.Defaults.EndpointStyle;
				ep.hoverPaintStyle = ep.hoverPaintStyle ||
	                           _currentInstance.Defaults.EndpointHoverStyles[epIndex] ||
	                           _currentInstance.Defaults.EndpointHoverStyle ||
	                           jsPlumb.Defaults.EndpointHoverStyles[epIndex] ||
	                           jsPlumb.Defaults.EndpointHoverStyle;                            

				ep.anchor = ep.anchor ||
	                      	_currentInstance.Defaults.Anchors[epIndex] ||
	                      	_currentInstance.Defaults.Anchor ||
	                      	jsPlumb.Defaults.Anchors[epIndex] ||
	                      	jsPlumb.Defaults.Anchor;                           
					
				ep.endpoint = ep.endpoint ||
							  _currentInstance.Defaults.Endpoints[epIndex] ||
							  _currentInstance.Defaults.Endpoint ||
							  jsPlumb.Defaults.Endpoints[epIndex] ||
							  jsPlumb.Defaults.Endpoint;
			};

		this.makeTarget = function(el, params, referenceParams) {						
			
			var p = jsPlumb.extend({_jsPlumb:_currentInstance}, referenceParams);
			jsPlumb.extend(p, params);
			_setEndpointPaintStylesAndAnchor(p, 1);                                                    
			var jpcl = jsPlumb.CurrentLibrary,
			    targetScope = p.scope || _currentInstance.Defaults.Scope,
			    deleteEndpointsOnDetach = !(p.deleteEndpointsOnDetach === false),
			    maxConnections = p.maxConnections || -1,
				onMaxConnections = p.onMaxConnections;
			_doOne = function(_el) {
				
				// get the element's id and store the endpoint definition for it.  jsPlumb.connect calls will look for one of these,
				// and use the endpoint definition if found.
				var elid = _getId(_el);
				_targetEndpointDefinitions[elid] = p;
				_targetEndpointsUnique[elid] = p.uniqueEndpoint,
				_targetMaxConnections[elid] = maxConnections,
				_targetsEnabled[elid] = true,
				proxyComponent = new jsPlumbUIComponent(p);								
				
				var dropOptions = jsPlumb.extend({}, p.dropOptions || {}),
				_drop = function() {

					var originalEvent = jsPlumb.CurrentLibrary.getDropEvent(arguments),
						targetCount = _currentInstance.select({target:elid}).length;																							

					_currentInstance.currentlyDragging = false;
					var draggable = _getElementObject(jpcl.getDragObject(arguments)),
						id = _getAttribute(draggable, "dragId"),				
						// restore the original scope if necessary (issue 57)
						scope = _getAttribute(draggable, "originalScope"),
						jpc = floatingConnections[id],
						source = jpc.endpoints[0],
						_endpoint = p.endpoint ? jsPlumb.extend({}, p.endpoint) : {};
						
					if (!_targetsEnabled[elid] || _targetMaxConnections[elid] > 0 && targetCount >= _targetMaxConnections[elid]){
						//console.log("target element " + elid + " is full.");
						if (onMaxConnections) {
							onMaxConnections({
								element:_el,
								connection:jpc
							}, originalEvent);
						}
						return false;
					}

					// unlock the source anchor to allow it to refresh its position if necessary
					source.anchor.locked = false;					
										
					if (scope) jpcl.setDragScope(draggable, scope);				
					
					// check if drop is allowed here.					
					//var _continue = jpc.isDropAllowed(jpc.sourceId, _getId(_el), jpc.scope);		
					var _continue = proxyComponent.isDropAllowed(jpc.sourceId, _getId(_el), jpc.scope, jpc, null);		
					
					// regardless of whether the connection is ok, reconfigure the existing connection to 
					// point at the current info. we need this to be correct for the detach event that will follow.
					// clear the source endpoint from the list to detach. we will detach this connection at this
					// point, but we want to keep the source endpoint.  the target is a floating endpoint and should
					// be removed.  TODO need to figure out whether this code can result in endpoints kicking around
					// when they shouldnt be.  like is this a full detach of a connection?  can it be?
					if (jpc.endpointsToDeleteOnDetach) {
						if (source === jpc.endpointsToDeleteOnDetach[0])
							jpc.endpointsToDeleteOnDetach[0] = null;
						else if (source === jpc.endpointsToDeleteOnDetach[1])
							jpc.endpointsToDeleteOnDetach[1] = null;
					}
					// reinstate any suspended endpoint; this just puts the connection back into
					// a state in which it will report sensible values if someone asks it about
					// its target.  we're going to throw this connection away shortly so it doesnt matter
					// if we manipulate it a bit.
					if (jpc.suspendedEndpoint) {
						jpc.targetId = jpc.suspendedEndpoint.elementId;
						jpc.target = jpcl.getElementObject(jpc.suspendedEndpoint.elementId);
						jpc.endpoints[1] = jpc.suspendedEndpoint;
					}																										
					
					if (_continue) {
					
						// detach this connection from the source.						
						source.detach(jpc, false, true, false);
					
						// make a new Endpoint for the target												
						var newEndpoint = _targetEndpoints[elid] || _currentInstance.addEndpoint(_el, p);
						if (p.uniqueEndpoint) _targetEndpoints[elid] = newEndpoint;  // may of course just store what it just pulled out. that's ok.
						newEndpoint._makeTargetCreator = true;
																
						// if the anchor has a 'positionFinder' set, then delegate to that function to find
						// out where to locate the anchor.
						if (newEndpoint.anchor.positionFinder != null) {
							var dropPosition = jpcl.getUIPosition(arguments, _currentInstance.getZoom()),
							elPosition = _getOffset(_el, _currentInstance),
							elSize = _getSize(_el),
							ap = newEndpoint.anchor.positionFinder(dropPosition, elPosition, elSize, newEndpoint.anchor.constructorParams);
							newEndpoint.anchor.x = ap[0];
							newEndpoint.anchor.y = ap[1];
							// now figure an orientation for it..kind of hard to know what to do actually. probably the best thing i can do is to
							// support specifying an orientation in the anchor's spec. if one is not supplied then i will make the orientation 
							// be what will cause the most natural link to the source: it will be pointing at the source, but it needs to be
							// specified in one axis only, and so how to make that choice? i think i will use whichever axis is the one in which
							// the target is furthest away from the source.
						}
						var c = _currentInstance.connect({
							source:source,
							target:newEndpoint,
							scope:scope,
							previousConnection:jpc,
							container:jpc.parent,
							deleteEndpointsOnDetach:deleteEndpointsOnDetach,
							// 'endpointWillMoveAfterConnection' is set by the makeSource function, and it indicates that the
							// given endpoint will actually transfer from the element it is currently attached to to some other
							// element after a connection has been established.  in that case, we do not want to fire the
							// connection event, since it will have the wrong data in it; makeSource will do it for us.
							// this is controlled by the 'parent' parameter on a makeSource call.
							doNotFireConnectionEvent:source.endpointWillMoveAfterConnection
						});

						// delete the original target endpoint.  but only want to do this if the endpoint was created
						// automatically and has no other connections.
						if (jpc.endpoints[1]._makeTargetCreator && jpc.endpoints[1].connections.length < 2)
							_currentInstance.deleteEndpoint(jpc.endpoints[1]);

						if (deleteEndpointsOnDetach) 
							c.endpointsToDeleteOnDetach = [ source, newEndpoint ];

						c.repaint();
					}				
					// if not allowed to drop...
					else {
						// TODO this code is identical (pretty much) to what happens when a connection
						// dragged from a normal endpoint is in this situation. refactor.
						// is this an existing connection, and will we reattach?
						if (jpc.suspendedEndpoint) {
							//if (source.isReattach) {
							if (jpc.isReattach()) {
								jpc.setHover(false);
								jpc.floatingAnchorIndex = null;
								jpc.suspendedEndpoint.addConnection(jpc);
								_currentInstance.repaint(source.elementId);
							}
							else
								source.detach(jpc, false, true, true, originalEvent);  // otherwise, detach the connection and tell everyone about it.
						}
						
					}														
				};
				
				var dropEvent = jpcl.dragEvents['drop'];
				dropOptions["scope"] = dropOptions["scope"] || targetScope;
				dropOptions[dropEvent] = _wrap(dropOptions[dropEvent], _drop);
				
				jpcl.initDroppable(_el, dropOptions, true);
			};
			
			el = _convertYUICollection(el);			
			
			var inputs = el.length && el.constructor != String ? el : [ el ];
						
			for (var i = 0; i < inputs.length; i++) {			
				_doOne(_getElementObject(inputs[i]));
			}

			return _currentInstance;
		};

		/*
		*	Function: unmakeTarget
		*	Sets the given element to no longer be a connection target.
		*	Parameters:
		*	el - either a string id or a selector representing the element.
		*	Returns:
		*	The current jsPlumb instance.
		*/
		this.unmakeTarget = function(el, doNotClearArrays) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			var elid = _getId(el);			

			// TODO this is not an exhaustive unmake of a target, since it does not remove the droppable stuff from
			// the element.  the effect will be to prevent it form behaving as a target, but it's not completely purged.
			if (!doNotClearArrays) {
				delete _targetEndpointDefinitions[elid];
				delete _targetEndpointsUnique[elid];
				delete _targetMaxConnections[elid];
				delete _targetsEnabled[elid];
			}

			return _currentInstance;
		};
		
		/**
		 * helper method to make a list of elements drop targets.
		 * @param els
		 * @param params
		 * @param referenceParams
		 * @return
		 */
		this.makeTargets = function(els, params, referenceParams) {
			for ( var i = 0; i < els.length; i++) {
				_currentInstance.makeTarget(els[i], params, referenceParams);				
			}
		};
		
		/**
		 * Function: makeSource
		 * Makes some DOM element a Connection source, allowing you to drag connections from it
		 * without having to register any Endpoints on it first.  When a Connection is established,
		 * the endpoint spec that was passed in to this method is used to create a suitable 
		 * Endpoint (the default will be used if you do not provide one).
		 * 
		 * Parameters:
		 *  el		-	string id or element selector for the element to make a source.
		 * 	params	-	JS object containing parameters:
		 * 	  endpoint	optional.	specification of an endpoint to create when a connection is created.
		 * 	  parent	optional.   the element to add Endpoints to when a Connection is established.  if you omit this, 
		 *                          Endpoints will be added to 'el'.
		 * 	  scope		optional.   scope for the connections dragged from this element.
		 * 	  dragOptions optional. same stuff as you would pass to dragOptions of an Endpoint definition.
		 * 	  deleteEndpointsOnDetach  optional, defaults to false. whether or not to delete
		 *                             any Endpoints created by a connection from this source if
		 *                             the connection is subsequently detached. this will not 
		 *                             remove Endpoints that have had more Connections attached
		 *                             to them after they were created.
		 * filter - optional function to call when the user presses the mouse button to start a drag. This function is passed the original 
		 * event and the element on which the associated makeSource call was made.  If it returns anything other than false,
		 * the drag begins as usual. But if it returns false (the boolean false, not something falsey), the drag is aborted.
		 *                   	
		 * 
		 */
		var _sourceEndpointDefinitions = {},
			_sourceEndpoints = {},
			_sourceEndpointsUnique = {},
			_sourcesEnabled = {},
			_sourceTriggers = {},
			_sourceMaxConnections = {},
			_targetsEnabled = {};

		this.makeSource = function(el, params, referenceParams) {
			var p = jsPlumb.extend({}, referenceParams);
			jsPlumb.extend(p, params);
			_setEndpointPaintStylesAndAnchor(p, 0);   
			var jpcl = jsPlumb.CurrentLibrary,
				maxConnections = p.maxConnections || -1,
				onMaxConnections = p.onMaxConnections,
			_doOne = function(_el) {
				// get the element's id and store the endpoint definition for it.  jsPlumb.connect calls will look for one of these,
				// and use the endpoint definition if found.
				var elid = _getId(_el),
					parent = p.parent,
					idToRegisterAgainst = parent != null ? _currentInstance.getId(jpcl.getElementObject(parent)) : elid;
				
				_sourceEndpointDefinitions[idToRegisterAgainst] = p;
				_sourceEndpointsUnique[idToRegisterAgainst] = p.uniqueEndpoint;
				_sourcesEnabled[idToRegisterAgainst] = true;

				var stopEvent = jpcl.dragEvents["stop"],
					dragEvent = jpcl.dragEvents["drag"],
					dragOptions = jsPlumb.extend({ }, p.dragOptions || {}),
					existingDrag = dragOptions.drag,
					existingStop = dragOptions.stop,
					ep = null,
					endpointAddedButNoDragYet = false;
				
				_sourceMaxConnections[idToRegisterAgainst] = maxConnections;	

				// set scope if its not set in dragOptions but was passed in in params
				dragOptions["scope"] = dragOptions["scope"] || p.scope;

				dragOptions[dragEvent] = _wrap(dragOptions[dragEvent], function() {
					if (existingDrag) existingDrag.apply(this, arguments);
					endpointAddedButNoDragYet = false;
				});
					
				dragOptions[stopEvent] = _wrap(dragOptions[stopEvent], function() { 							
					if (existingStop) existingStop.apply(this, arguments);								

                    //_currentlyDown = false;
					_currentInstance.currentlyDragging = false;
					
					if (ep.connections.length == 0)
						_currentInstance.deleteEndpoint(ep);
					else {
						
						jpcl.unbind(ep.canvas, "mousedown"); 
								
						// reset the anchor to the anchor that was initially provided. the one we were using to drag
						// the connection was just a placeholder that was located at the place the user pressed the
						// mouse button to initiate the drag.
						var anchorDef = p.anchor || _currentInstance.Defaults.Anchor,
							oldAnchor = ep.anchor,
							oldConnection = ep.connections[0];

						ep.anchor = _currentInstance.makeAnchor(anchorDef, elid, _currentInstance);																							
						
						if (p.parent) {						
							var parent = jpcl.getElementObject(p.parent);
							if (parent) {	
								var currentId = ep.elementId;
											
								var potentialParent = p.container || _currentInstance.Defaults.Container || jsPlumb.Defaults.Container;			
																
								ep.setElement(parent, potentialParent);
								ep.endpointWillMoveAfterConnection = false;														
								_currentInstance.anchorManager.rehomeEndpoint(currentId, parent);													
								oldConnection.previousConnection = null;
								// remove from connectionsByScope
								_removeWithFunction(connectionsByScope[oldConnection.scope], function(c) {
									return c.id === oldConnection.id;
								});										
								_currentInstance.anchorManager.connectionDetached({
									sourceId:oldConnection.sourceId,
									targetId:oldConnection.targetId,
									connection:oldConnection
								});											
								_finaliseConnection(oldConnection);					
							}
						}						
						
						ep.repaint();			
						_currentInstance.repaint(ep.elementId);																		
						_currentInstance.repaint(oldConnection.targetId);

					}				
				});
				// when the user presses the mouse, add an Endpoint, if we are enabled.
				var mouseDownListener = function(e) {

					// if disabled, return.
					if (!_sourcesEnabled[idToRegisterAgainst]) return;
					
					// if maxConnections reached
					var sourceCount = _currentInstance.select({source:idToRegisterAgainst}).length
					if (_sourceMaxConnections[idToRegisterAgainst] >= 0 && sourceCount >= _sourceMaxConnections[idToRegisterAgainst]) {
						if (onMaxConnections) {
							onMaxConnections({
								element:_el,
								maxConnections:maxConnections
							}, e);
						}
						return false;
					}

					// if a filter was given, run it, and return if it says no.
					if (params.filter) {
						// pass the original event to the user: 
						var r = params.filter(jpcl.getOriginalEvent(e), _el);
						if (r === false) return;
					}

					// make sure we have the latest offset for this div 
					var myOffsetInfo = _updateOffset({elId:elid});		

					var x = ((e.pageX || e.page.x) - myOffsetInfo.left) / myOffsetInfo.width, 
					    y = ((e.pageY || e.page.y) - myOffsetInfo.top) / myOffsetInfo.height,
					    parentX = x, 
					    parentY = y;					
							
					// if there is a parent, the endpoint will actually be added to it now, rather than the div
					// that was the source.  in that case, we have to adjust the anchor position so it refers to
					// the parent.
					if (p.parent) {
						var pEl = jpcl.getElementObject(p.parent),
							pId = _getId(pEl);
						myOffsetInfo = _updateOffset({elId:pId});
						parentX = ((e.pageX || e.page.x) - myOffsetInfo.left) / myOffsetInfo.width, 
					    parentY = ((e.pageY || e.page.y) - myOffsetInfo.top) / myOffsetInfo.height;
					}											
					
					// we need to override the anchor in here, and force 'isSource', but we don't want to mess with
					// the params passed in, because after a connection is established we're going to reset the endpoint
					// to have the anchor we were given.
					var tempEndpointParams = {};
					jsPlumb.extend(tempEndpointParams, p);
					tempEndpointParams.isSource = true;
					tempEndpointParams.anchor = [x,y,0,0];
					tempEndpointParams.parentAnchor = [ parentX, parentY, 0, 0 ];
					tempEndpointParams.dragOptions = dragOptions;
					// if a parent was given we need to turn that into a "container" argument.  this is, by default,
					// the parent of the element we will move to, so parent of p.parent in this case.  however, if
					// the user has specified a 'container' on the endpoint definition or on 
					// the defaults, we should use that.
					if (p.parent) {
						var potentialParent = tempEndpointParams.container || _currentInstance.Defaults.Container || jsPlumb.Defaults.Container;
						if (potentialParent)
							tempEndpointParams.container = potentialParent;
						else
							tempEndpointParams.container = jsPlumb.CurrentLibrary.getParent(p.parent);
					}
					
					ep = _currentInstance.addEndpoint(elid, tempEndpointParams);

					endpointAddedButNoDragYet = true;
					// we set this to prevent connections from firing attach events before this function has had a chance
					// to move the endpoint.
					ep.endpointWillMoveAfterConnection = p.parent != null;
					ep.endpointWillMoveTo = p.parent ? jpcl.getElementObject(p.parent) : null;

                    var _delTempEndpoint = function() {
						// this mouseup event is fired only if no dragging occurred, by jquery and yui, but for mootools
						// it is fired even if dragging has occurred, in which case we would blow away a perfectly
						// legitimate endpoint, were it not for this check.  the flag is set after adding an
						// endpoint and cleared in a drag listener we set in the dragOptions above.
						if(endpointAddedButNoDragYet) {
							_currentInstance.deleteEndpoint(ep);
                        }
					};

					_currentInstance.registerListener(ep.canvas, "mouseup", _delTempEndpoint);
                    _currentInstance.registerListener(_el, "mouseup", _delTempEndpoint);
					
					// and then trigger its mousedown event, which will kick off a drag, which will start dragging
					// a new connection from this endpoint.
					jpcl.trigger(ep.canvas, "mousedown", e);
				};
               
                // register this on jsPlumb so that it can be cleared by a reset.
                _currentInstance.registerListener(_el, "mousedown", mouseDownListener);
                _sourceTriggers[elid] = mouseDownListener;
			};
			
			el = _convertYUICollection(el);			
			
			var inputs = el.length && el.constructor != String ? el : [ el ];
						
			for (var i = 0; i < inputs.length; i++) {			
				_doOne(_getElementObject(inputs[i]));
			}

			return _currentInstance;
		};

		/**
		*	Function: unmakeSource
		*	Sets the given element to no longer be a connection source.
		*	Parameters:
		*	el - either a string id or a selector representing the element.
		*	Returns:
		*	The current jsPlumb instance.
		*/
		this.unmakeSource = function(el, doNotClearArrays) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			var id = _getId(el),
				mouseDownListener = _sourceTriggers[id];
			
			if (mouseDownListener) 
				_currentInstance.unregisterListener(_el, "mousedown", mouseDownListener);

			if (!doNotClearArrays) {
				delete _sourceEndpointDefinitions[id];
				delete _sourceEndpointsUnique[id];
				delete _sourcesEnabled[id];
				delete _sourceTriggers[id];
				delete _sourceMaxConnections[id];
			}

			return _currentInstance;
		};

		/*
		*	Function: unmakeEverySource
		*	Resets all elements in this instance of jsPlumb so that none of them are connection sources.
		*	Returns:
		*	The current jsPlumb instance.
		*/
		this.unmakeEverySource = function() {
			for (var i in _sourcesEnabled)
				_currentInstance.unmakeSource(i, true);

			_sourceEndpointDefinitions = {};
			_sourceEndpointsUnique = {};
			_sourcesEnabled = {};
			_sourceTriggers = {};
		};

		/*
		*	Function: unmakeEveryTarget
		*	Resets all elements in this instance of jsPlumb so that none of them are connection targets.
		*	Returns:
		*	The current jsPlumb instance.
		*/
		this.unmakeEveryTarget = function() {
			for (var i in _targetsEnabled)
				_currentInstance.unmakeTarget(i, true);
			
			_targetEndpointDefinitions = {};
			_targetEndpointsUnique = {};
			_targetMaxConnections = {};
			_targetsEnabled = {};

			return _currentInstance;
		};
		
		/*
		 * Function: makeSources
		 * Makes all elements in some array or a selector connection sources.
		 * Parameters:
		 * 	els 	- 	either an array of ids or a selector
		 *  params  -   parameters to configure each element as a source with
		 *  referenceParams - extra parameters to configure each element as a source with.
		 *
		 * Returns:
		 * The current jsPlumb instance.
		 */
		this.makeSources = function(els, params, referenceParams) {
			for ( var i = 0; i < els.length; i++) {
				_currentInstance.makeSource(els[i], params, referenceParams);				
			}

			return _currentInstance;
		};

		// does the work of setting a source enabled or disabled.
		var _setEnabled = function(type, el, state, toggle) {
			var a = type == "source" ? _sourcesEnabled : _targetsEnabled;									

			if (_isString(el)) a[el] = toggle ? !a[el] : state;
			else if (el.length) {
				el = _convertYUICollection(el);
				for (var i = 0; i < el.length; i++) {
					var id = _el = jsPlumb.CurrentLibrary.getElementObject(el[i]), id = _getId(_el);
					a[id] = toggle ? !a[id] : state;
				}
			}	
			return _currentInstance;
		};

		/*
			Function: setSourceEnabled
			Sets the enabled state of one or more elements that were previously made a connection source with the makeSource
			method.

			Parameters:
				el 	- 	either a string representing some element's id, or an array of ids, or a selector.
				state - true to enable the element(s), false to disable it.

			Returns:
			The current jsPlumb instance.
		*/
		this.setSourceEnabled = function(el, state) {
			return _setEnabled("source", el, state);
		};

		/*
		*	Function: toggleSourceEnabled
		*	Toggles the source enabled state of the given element or elements.
		*
		* 	Parameters:
		*		el 	- 	either a string representing some element's id, or an array of ids, or a selector.
		*		state - true to enable the element(s), false to disable it.
		*
		*	Returns:
		*	The current enabled state of the source.
		*/	
		this.toggleSourceEnabled = function(el) {
			_setEnabled("source", el, null, true);	
			return _currentInstance.isSourceEnabled(el);
		};

		/*
		*	Function: isSource
		*	Returns whether or not the given element is registered as a connection source.
		*
		*	Parameters:
		*		el 	- 	either a string id, or a selector representing a single element.
		*
		*	Returns:
		*	True if source, false if not.
		*/
		this.isSource = function(el) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			return _sourcesEnabled[_getId(el)] != null;
		};

		/*
		*	Function: isSourceEnabled
		*	Returns whether or not the given connection source is enabled.
		*
		*	Parameters:
		*	el 	- 	either a string id, or a selector representing a single element.
		*
		*	Returns:
		*	True if enabled, false if not.
		*/
		this.isSourceEnabled = function(el) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			return _sourcesEnabled[_getId(el)] === true;
		};

		/*
		*	Function: setTargetEnabled
		*	Sets the enabled state of one or more elements that were previously made a connection target with the makeTarget method.
		*	method.
		*
		*	Parameters:
		*		el 	- 	either a string representing some element's id, or an array of ids, or a selector.
		*		state - true to enable the element(s), false to disable it.
		*
		*	Returns:
		*	The current jsPlumb instance.
		*/
		this.setTargetEnabled = function(el, state) {
			return _setEnabled("target", el, state);
		};

		/*
		*	Function: toggleTargetEnabled
		*	Toggles the target enabled state of the given element or elements.
		*
		*	Parameters:
		*		el 	- 	either a string representing some element's id, or an array of ids, or a selector.
		*		state - true to enable the element(s), false to disable it.
		*
		*	Returns:
		*	The current enabled state of the target.
		*/	
		this.toggleTargetEnabled = function(el) {
			return _setEnabled("target", el, null, true);	
			return _currentInstance.isTargetEnabled(el);
		};

		/*
			Function: isTarget
			Returns whether or not the given element is registered as a connection target.

			Parameters:
				el 	- 	either a string id, or a selector representing a single element.

			Returns:
			True if source, false if not.
		*/
		this.isTarget = function(el) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			return _targetsEnabled[_getId(el)] != null;
		};

		/*
			Function: isTargetEnabled
			Returns whether or not the given connection target is enabled.

			Parameters:
				el 	- 	either a string id, or a selector representing a single element.

			Returns:
			True if enabled, false if not.
		*/
		this.isTargetEnabled = function(el) {
			el = jsPlumb.CurrentLibrary.getElementObject(el);
			return _targetsEnabled[_getId(el)] === true;
		};
		
		/*
		  Function: ready
		  Helper method to bind a function to jsPlumb's ready event.
		 */
		this.ready = function(fn) {
			_currentInstance.bind("ready", fn);
		},

		/*
		  Function: repaint 
		  Repaints an element and its connections. This method gets new sizes for the elements before painting anything.
		  
		  Parameters: 
		  	el - either the id of the element or a selector representing the element.
		  	 
		  Returns: 
		  	void
		  	 
		  See Also: 
		  	<repaintEverything>
		 */
		this.repaint = function(el, ui, timestamp) {
			// support both lists...
			if (typeof el == 'object')
				for ( var i = 0; i < el.length; i++) {			
					_draw(_getElementObject(el[i]), ui, timestamp);
				}
			else // ...and single strings.				
				_draw(_getElementObject(el), ui, timestamp);
		};

		/*
		  Function: repaintEverything 
		  Repaints all connections.
		   
		  Returns: 
		  	void
		  	
		  See Also: 
		  	<repaint>
		 */
		this.repaintEverything = function() {				
			for ( var elId in endpointsByElement) {
				_draw(_getElementObject(elId));
			}
		};

		/*
		  Function: removeAllEndpoints 
		  Removes all Endpoints associated with a given element. Also removes all Connections associated with each Endpoint it removes.
		  
		  Parameters: 
		  	el - either an element id, or a selector for an element.
		  	 
		  Returns: 
		  	void
		  	 
		  See Also: 
		  	<removeEndpoint>
		 */
		this.removeAllEndpoints = function(el) {
			var elId = _getAttribute(el, "id"),
			    ebe = endpointsByElement[elId];
			if (ebe) {
				for ( var i = 0; i < ebe.length; i++) 
					_currentInstance.deleteEndpoint(ebe[i]);
			}
			endpointsByElement[elId] = [];
		};

		/*
		  Removes every Endpoint in this instance of jsPlumb.		   		  		  		  
		  @deprecated use deleteEveryEndpoint instead
		 */
		this.removeEveryEndpoint = this.deleteEveryEndpoint;
		
		/*
		  Removes the given Endpoint from the given element.		  		  
		  @deprecated Use jsPlumb.deleteEndpoint instead (and note you dont need to supply the element. it's irrelevant).
		 */
		this.removeEndpoint = function(el, endpoint) {
			_currentInstance.deleteEndpoint(endpoint);
		};

    var _registeredListeners = {},
        _unbindRegisteredListeners = function() {
            for (var i in _registeredListeners) {
                for (var j = 0; j < _registeredListeners[i].length; j++) {
                    var info = _registeredListeners[i][j];
                    jsPlumb.CurrentLibrary.unbind(info.el, info.event, info.listener);
                }
            }
            _registeredListeners = {};
        };

        // internal register listener method.  gives us a hook to clean things up
        // with if the user calls jsPlumb.reset.
        this.registerListener = function(el, type, listener) {
            jsPlumb.CurrentLibrary.bind(el, type, listener);
            _addToList(_registeredListeners, type, {el:el, event:type, listener:listener});
        };

        this.unregisterListener = function(el, type, listener) {
        	jsPlumb.CurrentLibrary.unbind(el, type, listener);
        	_removeWithFunction(_registeredListeners, function(rl) {
        		return rl.type == type && rl.listener == listener;
        	});
        };

		/*
		  Function:reset 
		  Removes all endpoints and connections and clears the listener list. To keep listeners call jsPlumb.deleteEveryEndpoint instead of this.
		 */
		this.reset = function() {			
        _currentInstance.deleteEveryEndpoint();
        _currentInstance.unbind();
        _targetEndpointDefinitions = {};
        _targetEndpoints = {};
        _targetEndpointsUnique = {};
        _targetMaxConnections = {};
        _sourceEndpointDefinitions = {};
        _sourceEndpoints = {};
        _sourceEndpointsUnique = {};
        _sourceMaxConnections = {};
        _unbindRegisteredListeners();
        _currentInstance.anchorManager.reset();
        if (!jsPlumbAdapter.headless)
            _currentInstance.dragManager.reset();
		};
		
		/*
		 * Function: setDefaultScope 
		 * Sets the default scope for Connections and Endpoints. A scope defines a type of Endpoint/Connection; supplying a
		 * scope to an Endpoint or Connection allows you to support different
		 * types of Connections in the same UI.  If you're only interested in
		 * one type of Connection, you don't need to supply a scope. This method
		 * will probably be used by very few people; it just instructs jsPlumb
		 * to use a different key for the default scope.
		 * 
		 * Parameters:
		 * 	scope - scope to set as default.
		 */
		this.setDefaultScope = function(scope) {
			DEFAULT_SCOPE = scope;
		};

		/*
		 * Function: setDraggable 
		 * Sets whether or not a given element is
		 * draggable, regardless of what any jsPlumb command may request.
		 * 
		 * Parameters: 
		 * 	el - either the id for the element, or a selector representing the element.
		 *  
		 * Returns: 
		 * 	void
		 */
		this.setDraggable = _setDraggable;

		/*
		* Function: setId
		* Changes the id of some element, adjusting all connections and endpoints
		*
		* Parameters:
		* el - a selector, a DOM element, or a string. 
		* newId - string.
		*/
		this.setId = function(el, newId, doNotSetAttribute) {
		
			var id = el.constructor == String ? el : _currentInstance.getId(el),
				sConns = _currentInstance.getConnections({source:id, scope:'*'}, true),
				tConns = _currentInstance.getConnections({target:id, scope:'*'}, true);

			newId = "" + newId;
							
			if (!doNotSetAttribute) {
				el = jsPlumb.CurrentLibrary.getElementObject(id);
				jsPlumb.CurrentLibrary.setAttribute(el, "id", newId);
			}
			
			el = jsPlumb.CurrentLibrary.getElementObject(newId);
			

			endpointsByElement[newId] = endpointsByElement[id] || [];
			for (var i = 0; i < endpointsByElement[newId].length; i++) {
				endpointsByElement[newId][i].elementId = newId;
				endpointsByElement[newId][i].element = el;
				endpointsByElement[newId][i].anchor.elementId = newId;
			}
			delete endpointsByElement[id];

			_currentInstance.anchorManager.changeId(id, newId);

			var _conns = function(list, epIdx, type) {
				for (var i = 0; i < list.length; i++) {
					list[i].endpoints[epIdx].elementId = newId;
					list[i].endpoints[epIdx].element = el;
					list[i][type + "Id"] = newId;
					list[i][type] = el;
				}
			};
			_conns(sConns, 0, "source");
			_conns(tConns, 1, "target");
		};

		/*
		* Function: setIdChanged
		* Notify jsPlumb that the element with oldId has had its id changed to newId.
		*/
		this.setIdChanged = function(oldId, newId) {
			_currentInstance.setId(oldId, newId, true);
		};

		this.setDebugLog = function(debugLog) {
			log = debugLog;
		};

		
		var _suspendDrawing = false,
				_suspendedAt = null;
		/*
		 * Function: setSuspendDrawing
		 * Suspends drawing operations.  This can be used when you have a lot of connections to make or endpoints to register;
		 * it will save you a lot of time.
		 */
		this.setSuspendDrawing = function(val, repaintAfterwards) {
		    _suspendDrawing = val;
				if (val) _suspendedAt = new Date().getTime(); else _suspendedAt = null;
		    if (repaintAfterwards) _currentInstance.repaintEverything();
		};
        
    /*
		* Function: isSuspendDrawing
    * Returns whether or not drawing is currently suspended.
    */
    this.isSuspendDrawing = function() {
				return _suspendDrawing;
    };
		
		/*
		 * Constant for use with the setRenderMode method
		 */
		this.CANVAS = "canvas";
		
		/*
		 * Constant for use with the setRenderMode method
		 */
		this.SVG = "svg";
		
		/*
		 * Constant for use with the setRenderMode method
		 */
		this.VML = "vml";
		
		/*
		 * Function: setRenderMode
		 * Sets render mode: jsPlumb.CANVAS, jsPlumb.SVG or jsPlumb.VML.  jsPlumb will fall back to VML if it determines that
		 * what you asked for is not supported (and that VML is).  If you asked for VML but the browser does
		 * not support it, jsPlumb uses SVG.  
		 * 
		 * Returns:
		 * the render mode that jsPlumb set, which of course may be different from that requested.
		 */
		this.setRenderMode = function(mode) {			
			renderMode = jsPlumbAdapter.setRenderMode(mode);
			return renderMode;
		};
		
		this.getRenderMode = function() { return renderMode; };

		/*
		 * Function: show 
		 * Sets an element's connections to be visible.
		 * 
		 * Parameters: 
		 * 	el - either the id of the element, or a selector for the element.
		 *  changeEndpoints - whether or not to also change the visible state of the endpoints on the element.  this also has a bearing on
		 *  other connections on those endpoints: if their other endpoint is also visible, the connections are made visible.  
		 *  
		 * Returns: 
		 * 	void
		 */
		this.show = function(el, changeEndpoints) {
			_setVisible(el, "block", changeEndpoints);
		};

		/*
		 * Function: sizeCanvas 
		 * Helper to size a canvas. You would typically use
		 * this when writing your own Connector or Endpoint implementation.
		 * 
		 * Parameters: 
		 * 	x - [int] x position for the Canvas origin 
		 * 	y - [int] y position for the Canvas origin 
		 * 	w - [int] width of the canvas 
		 * 	h - [int] height of the canvas
		 *  
		 * Returns: 
		 * 	void
		 */
		this.sizeCanvas = function(canvas, x, y, w, h) {
			if (canvas) {
				canvas.style.height = h + "px";
				canvas.height = h;
				canvas.style.width = w + "px";
				canvas.width = w;
				canvas.style.left = x + "px";
				canvas.style.top = y + "px";
			}
		};

		/**
		 * gets some test hooks. nothing writable.
		 */
		this.getTestHarness = function() {
			return {
				endpointsByElement : endpointsByElement,  
				endpointCount : function(elId) {
					var e = endpointsByElement[elId];
					return e ? e.length : 0;
				},
				connectionCount : function(scope) {
					scope = scope || DEFAULT_SCOPE;
					var c = connectionsByScope[scope];
					return c ? c.length : 0;
				},
				//findIndex : _findIndex,
				getId : _getId,
				makeAnchor:self.makeAnchor,
				makeDynamicAnchor:self.makeDynamicAnchor
			};
		};

		/**
		 * Toggles visibility of an element's connections. kept for backwards
		 * compatibility
		 */
		this.toggle = _toggleVisible;

		/*
		 * Function: toggleVisible 
		 * Toggles visibility of an element's Connections.
		 *  
		 * Parameters: 
		 * 	el - either the element's id, or a selector representing the element.
		 *  changeEndpoints - whether or not to also toggle the endpoints on the element.
		 *  
		 * Returns: 
		 * 	void, but should be updated to return the current state
		 */
		// TODO: update this method to return the current state.
		this.toggleVisible = _toggleVisible;

		/*
		 * Function: toggleDraggable 
		 * Toggles draggability (sic?) of an element's Connections.
		 *  
		 * Parameters: 
		 * 	el - either the element's id, or a selector representing the element.
		 *  
		 * Returns: 
		 * 	The current draggable state.
		 */
		this.toggleDraggable = _toggleDraggable;		

		/*
		 * Helper method to wrap an existing function with one of
		 * your own. This is used by the various implementations to wrap event
		 * callbacks for drag/drop etc; it allows jsPlumb to be transparent in
		 * its handling of these things. If a user supplies their own event
		 * callback, for anything, it will always be called. 
		 */
		this.wrap = _wrap;			
		this.addListener = this.bind;
		
		var adjustForParentOffsetAndScroll = function(xy, el) {

			var offsetParent = null, result = xy;
			if (el.tagName.toLowerCase() === "svg" && el.parentNode) {
				offsetParent = el.parentNode;
			}
			else if (el.offsetParent) {
				offsetParent = el.offsetParent;					
			}
			if (offsetParent != null) {
				var po = offsetParent.tagName.toLowerCase() === "body" ? {left:0,top:0} : _getOffset(offsetParent, _currentInstance),
					so = offsetParent.tagName.toLowerCase() === "body" ? {left:0,top:0} : {left:offsetParent.scrollLeft, top:offsetParent.scrollTop};					


				// i thought it might be cool to do this:
				//	lastReturnValue[0] = lastReturnValue[0] - offsetParent.offsetLeft + offsetParent.scrollLeft;
				//	lastReturnValue[1] = lastReturnValue[1] - offsetParent.offsetTop + offsetParent.scrollTop;					
				// but i think it ignores margins.  my reasoning was that it's quicker to not hand off to some underlying					
				// library.
				
				result[0] = xy[0] - po.left + so.left;
				result[1] = xy[1] - po.top + so.top;
			}
		
			return result;
			
		};

		/**
		 * Anchors model a position on some element at which an Endpoint may be located.  They began as a first class citizen of jsPlumb, ie. a user
		 * was required to create these themselves, but over time this has been replaced by the concept of referring to them either by name (eg. "TopMiddle"),
		 * or by an array describing their coordinates (eg. [ 0, 0.5, 0, -1 ], which is the same as "TopMiddle").  jsPlumb now handles all of the
		 * creation of Anchors without user intervention.
		 */
		var Anchor = function(params) {
			var self = this;
			this.x = params.x || 0;
			this.y = params.y || 0;
			this.elementId = params.elementId;
			var orientation = params.orientation || [ 0, 0 ];
			var lastTimestamp = null, lastReturnValue = null;
			this.offsets = params.offsets || [ 0, 0 ];
			self.timestamp = null;
			this.compute = function(params) {
				var xy = params.xy, wh = params.wh, element = params.element, timestamp = params.timestamp;
				
				if (timestamp && timestamp === self.timestamp)
					return lastReturnValue;
	
				lastReturnValue = [ xy[0] + (self.x * wh[0]) + self.offsets[0], xy[1] + (self.y * wh[1]) + self.offsets[1] ];
				
				// adjust loc if there is an offsetParent
				lastReturnValue = adjustForParentOffsetAndScroll(lastReturnValue, element.canvas);
				
				self.timestamp = timestamp;
				return lastReturnValue;
			};

			this.getOrientation = function(_endpoint) { return orientation; };

			this.equals = function(anchor) {
				if (!anchor) return false;
				var ao = anchor.getOrientation();
				var o = this.getOrientation();
				return this.x == anchor.x && this.y == anchor.y
						&& this.offsets[0] == anchor.offsets[0]
						&& this.offsets[1] == anchor.offsets[1]
						&& o[0] == ao[0] && o[1] == ao[1];
			};

			this.getCurrentLocation = function() { return lastReturnValue; };
		};

		/**
		 * An Anchor that floats. its orientation is computed dynamically from
		 * its position relative to the anchor it is floating relative to.  It is used when creating 
		 * a connection through drag and drop.
		 * 
		 * TODO FloatingAnchor could totally be refactored to extend Anchor just slightly.
		 */
		var FloatingAnchor = function(params) {

			// this is the anchor that this floating anchor is referenced to for
			// purposes of calculating the orientation.
			var ref = params.reference,
			// the canvas this refers to.
			refCanvas = params.referenceCanvas,
			size = _getSize(_getElementObject(refCanvas)),

			// these are used to store the current relative position of our
			// anchor wrt the reference anchor. they only indicate
			// direction, so have a value of 1 or -1 (or, very rarely, 0). these
			// values are written by the compute method, and read
			// by the getOrientation method.
			xDir = 0, yDir = 0,
			// temporary member used to store an orientation when the floating
			// anchor is hovering over another anchor.
			orientation = null,
			_lastResult = null;

			// set these to 0 each; they are used by certain types of connectors in the loopback case,
			// when the connector is trying to clear the element it is on. but for floating anchor it's not
			// very important.
			this.x = 0; this.y = 0;

			this.isFloating = true;

			this.compute = function(params) {
				var xy = params.xy, element = params.element,
				result = [ xy[0] + (size[0] / 2), xy[1] + (size[1] / 2) ]; // return origin of the element. we may wish to improve this so that any object can be the drag proxy.
							
				// adjust loc if there is an offsetParent
				result = adjustForParentOffsetAndScroll(result, element.canvas);
				
				_lastResult = result;
				return result;
			};

			this.getOrientation = function(_endpoint) {
				if (orientation) return orientation;
				else {
					var o = ref.getOrientation(_endpoint);
					// here we take into account the orientation of the other
					// anchor: if it declares zero for some direction, we declare zero too. this might not be the most awesome. perhaps we can come
					// up with a better way. it's just so that the line we draw looks like it makes sense. maybe this wont make sense.
					return [ Math.abs(o[0]) * xDir * -1,
							Math.abs(o[1]) * yDir * -1 ];
				}
			};

			/**
			 * notification the endpoint associated with this anchor is hovering
			 * over another anchor; we want to assume that anchor's orientation
			 * for the duration of the hover.
			 */
			this.over = function(anchor) { 
				orientation = anchor.getOrientation(); 
			};

			/**
			 * notification the endpoint associated with this anchor is no
			 * longer hovering over another anchor; we should resume calculating
			 * orientation as we normally do.
			 */
			this.out = function() { orientation = null; };

			this.getCurrentLocation = function() { return _lastResult; };
		};

		/* 
		 * A DynamicAnchor is an Anchor that contains a list of other Anchors, which it cycles
		 * through at compute time to find the one that is located closest to
		 * the center of the target element, and returns that Anchor's compute
		 * method result. this causes endpoints to follow each other with
		 * respect to the orientation of their target elements, which is a useful
		 * feature for some applications.
		 * 
		 */
		var DynamicAnchor = function(anchors, anchorSelector, elementId) {
			this.isSelective = true;
			this.isDynamic = true;			
			var _anchors = [], self = this,
			_convert = function(anchor) { 
				return anchor.constructor == Anchor ? anchor: _currentInstance.makeAnchor(anchor, elementId, _currentInstance); 
			};
			for (var i = 0; i < anchors.length; i++) 
				_anchors[i] = _convert(anchors[i]);			
			this.addAnchor = function(anchor) { _anchors.push(_convert(anchor)); };
			this.getAnchors = function() { return _anchors; };
			this.locked = false;
			var _curAnchor = _anchors.length > 0 ? _anchors[0] : null,
				_curIndex = _anchors.length > 0 ? 0 : -1,
				self = this,
			
				// helper method to calculate the distance between the centers of the two elements.
				_distance = function(anchor, cx, cy, xy, wh) {
					var ax = xy[0] + (anchor.x * wh[0]), ay = xy[1] + (anchor.y * wh[1]);
					return Math.sqrt(Math.pow(cx - ax, 2) + Math.pow(cy - ay, 2));
				},
			
			// default method uses distance between element centers.  you can provide your own method in the dynamic anchor
			// constructor (and also to jsPlumb.makeDynamicAnchor). the arguments to it are four arrays: 
			// xy - xy loc of the anchor's element
			// wh - anchor's element's dimensions
			// txy - xy loc of the element of the other anchor in the connection
			// twh - dimensions of the element of the other anchor in the connection.
			// anchors - the list of selectable anchors
			_anchorSelector = anchorSelector || function(xy, wh, txy, twh, anchors) {
				var cx = txy[0] + (twh[0] / 2), cy = txy[1] + (twh[1] / 2);
				var minIdx = -1, minDist = Infinity;
				for ( var i = 0; i < anchors.length; i++) {
					var d = _distance(anchors[i], cx, cy, xy, wh);
					if (d < minDist) {
						minIdx = i + 0;
						minDist = d;
					}
				}
				return anchors[minIdx];
			};
			
			this.compute = function(params) {				
				var xy = params.xy, wh = params.wh, timestamp = params.timestamp, txy = params.txy, twh = params.twh;				
				// if anchor is locked or an opposite element was not given, we
				// maintain our state. anchor will be locked
				// if it is the source of a drag and drop.
				if (self.locked || txy == null || twh == null)
					return _curAnchor.compute(params);				
				else
					params.timestamp = null; // otherwise clear this, i think. we want the anchor to compute.
				
				_curAnchor = _anchorSelector(xy, wh, txy, twh, _anchors);
				self.x = _curAnchor.x;
				self.y = _curAnchor.y;
				
				return _curAnchor.compute(params);
			};

			this.getCurrentLocation = function() {
				return _curAnchor != null ? _curAnchor.getCurrentLocation() : null;
			};

			this.getOrientation = function(_endpoint) { return _curAnchor != null ? _curAnchor.getOrientation(_endpoint) : [ 0, 0 ]; };
			this.over = function(anchor) { if (_curAnchor != null) _curAnchor.over(anchor); };
			this.out = function() { if (_curAnchor != null) _curAnchor.out(); };
		};
		
	/*
	manages anchors for all elements.
	*/
	// "continuous" anchors: anchors that pick their location based on how many connections the given element has.
	// this requires looking at a lot more elements than normal - anything that has had a Continuous anchor applied has
	// to be recalculated.  so this manager is used as a reference point.  the first time, with a new timestamp, that
	// a continuous anchor is asked to compute, it calls this guy.  or maybe, even, this guy gets called somewhere else
	// and compute only ever returns pre-computed values.  either way, this is the central point, and we want it to
	// be called as few times as possible.
	var continuousAnchors = {},
        continuousAnchorLocations = {},
	    continuousAnchorOrientations = {},
	    Orientation = { HORIZONTAL : "horizontal", VERTICAL : "vertical", DIAGONAL : "diagonal", IDENTITY:"identity" },
    
	// TODO this functions uses a crude method of determining orientation between two elements.
	// 'diagonal' should be chosen when the angle of the line between the two centers is around
	// one of 45, 135, 225 and 315 degrees. maybe +- 15 degrees.
	calculateOrientation = function(sourceId, targetId, sd, td) {

		if (sourceId === targetId) return {
			orientation:Orientation.IDENTITY,
			a:["top", "top"]
		};

		var theta = Math.atan2((td.centery - sd.centery) , (td.centerx - sd.centerx)),
		    theta2 = Math.atan2((sd.centery - td.centery) , (sd.centerx - td.centerx)),
		    h = ((sd.left <= td.left && sd.right >= td.left) || (sd.left <= td.right && sd.right >= td.right) ||
			    (sd.left <= td.left && sd.right >= td.right) || (td.left <= sd.left && td.right >= sd.right)),
		    v = ((sd.top <= td.top && sd.bottom >= td.top) || (sd.top <= td.bottom && sd.bottom >= td.bottom) ||
			    (sd.top <= td.top && sd.bottom >= td.bottom) || (td.top <= sd.top && td.bottom >= sd.bottom));

		if (! (h || v)) {
			var a = null, rls = false, rrs = false, sortValue = null;
			if (td.left > sd.left && td.top > sd.top)
				a = ["right", "top"];
			else if (td.left > sd.left && sd.top > td.top)
				a = [ "top", "left"];
			else if (td.left < sd.left && td.top < sd.top)
				a = [ "top", "right"];
			else if (td.left < sd.left && td.top > sd.top)
				a = ["left", "top" ];

			return { orientation:Orientation.DIAGONAL, a:a, theta:theta, theta2:theta2 };
		}
		else if (h) return {
			orientation:Orientation.HORIZONTAL,
			a:sd.top < td.top ? ["bottom", "top"] : ["top", "bottom"],
			theta:theta, theta2:theta2
		}
		else return {
			orientation:Orientation.VERTICAL,
			a:sd.left < td.left ? ["right", "left"] : ["left", "right"],
			theta:theta, theta2:theta2
		}
	},
	placeAnchorsOnLine = function(desc, elementDimensions, elementPosition,
					connections, horizontal, otherMultiplier, reverse) {
		var a = [], step = elementDimensions[horizontal ? 0 : 1] / (connections.length + 1);

		for (var i = 0; i < connections.length; i++) {
			var val = (i + 1) * step, other = otherMultiplier * elementDimensions[horizontal ? 1 : 0];
			if (reverse)
			  val = elementDimensions[horizontal ? 0 : 1] - val;

			var dx = (horizontal ? val : other), x = elementPosition[0] + dx,  xp = dx / elementDimensions[0],
			 	dy = (horizontal ? other : val), y = elementPosition[1] + dy, yp = dy / elementDimensions[1];

			a.push([ x, y, xp, yp, connections[i][1], connections[i][2] ]);
		}

		return a;
	},
	standardEdgeSort = function(a, b) { return a[0] > b[0] ? 1 : -1 },
	currySort = function(reverseAngles) {
		return function(a,b) {
            var r = true;
			if (reverseAngles) {
				if (a[0][0] < b[0][0])
					r = true;
				else
					r = a[0][1] > b[0][1];
			}
			else {
				if (a[0][0] > b[0][0])
					r= true;
				else
					r =a[0][1] > b[0][1];
			}
            return r === false ? -1 : 1;
		};
	},
	leftSort = function(a,b) {
		// first get adjusted values
		var p1 = a[0][0] < 0 ? -Math.PI - a[0][0] : Math.PI - a[0][0],
		p2 = b[0][0] < 0 ? -Math.PI - b[0][0] : Math.PI - b[0][0];
		if (p1 > p2) return 1;
		else return a[0][1] > b[0][1] ? 1 : -1;
	},
	edgeSortFunctions = {
		"top":standardEdgeSort,
		"right":currySort(true),
		"bottom":currySort(true),
		"left":leftSort
	},
    _sortHelper = function(_array, _fn) {
      return _array.sort(_fn);
    },
	placeAnchors = function(elementId, _anchorLists) {		
		var sS = sizes[elementId], sO = offsets[elementId],
		placeSomeAnchors = function(desc, elementDimensions, elementPosition, unsortedConnections, isHorizontal, otherMultiplier, orientation) {
            if (unsortedConnections.length > 0) {
			    var sc = _sortHelper(unsortedConnections, edgeSortFunctions[desc]), // puts them in order based on the target element's pos on screen			    
				    reverse = desc === "right" || desc === "top",
				    anchors = placeAnchorsOnLine(desc, elementDimensions,
											 elementPosition, sc,
											 isHorizontal, otherMultiplier, reverse );

			    // takes a computed anchor position and adjusts it for parent offset and scroll, then stores it.
			    var _setAnchorLocation = function(endpoint, anchorPos) {
				    var a = adjustForParentOffsetAndScroll([anchorPos[0], anchorPos[1]], endpoint.canvas);
				    continuousAnchorLocations[endpoint.id] = [ a[0], a[1], anchorPos[2], anchorPos[3] ];
				    continuousAnchorOrientations[endpoint.id] = orientation;
			    };

			    for (var i = 0; i < anchors.length; i++) {
				    var c = anchors[i][4], weAreSource = c.endpoints[0].elementId === elementId, weAreTarget = c.endpoints[1].elementId === elementId;
				    if (weAreSource)
					    _setAnchorLocation(c.endpoints[0], anchors[i]);
				    else if (weAreTarget)
					    _setAnchorLocation(c.endpoints[1], anchors[i]);
			    }
            }
		};

		placeSomeAnchors("bottom", sS, [sO.left,sO.top], _anchorLists.bottom, true, 1, [0,1]);
		placeSomeAnchors("top", sS, [sO.left,sO.top], _anchorLists.top, true, 0, [0,-1]);
		placeSomeAnchors("left", sS, [sO.left,sO.top], _anchorLists.left, false, 0, [-1,0]);
		placeSomeAnchors("right", sS, [sO.left,sO.top], _anchorLists.right, false, 1, [1,0]);
	},
    AnchorManager = function() {
		var _amEndpoints = {},
			connectionsByElementId = {},
			self = this,
            anchorLists = {};

        this.reset = function() {
        	_amEndpoints = {};
        	connectionsByElementId = {};
            anchorLists = {};
        };			
 		this.newConnection = function(conn) {
			var sourceId = conn.sourceId, targetId = conn.targetId,
				ep = conn.endpoints,
                doRegisterTarget = true,
			    registerConnection = function(otherIndex, otherEndpoint, otherAnchor, elId, c) {

					if ((sourceId == targetId) && otherAnchor.isContinuous){
                       // remove the target endpoint's canvas.  we dont need it.
                        jsPlumb.CurrentLibrary.removeElement(ep[1].canvas);
                        doRegisterTarget = false;
                    }
					_addToList(connectionsByElementId, elId, [c, otherEndpoint, otherAnchor.constructor == DynamicAnchor]);
			    };

			registerConnection(0, ep[0], ep[0].anchor, targetId, conn);
            if (doRegisterTarget)
            	registerConnection(1, ep[1], ep[1].anchor, sourceId, conn);
		};
		this.connectionDetached = function(connInfo) {
			var connection = connInfo.connection || connInfo;
			var sourceId = connection.sourceId,
                targetId = connection.targetId,
				ep = connection.endpoints,
				removeConnection = function(otherIndex, otherEndpoint, otherAnchor, elId, c) {
					if (otherAnchor.constructor == FloatingAnchor) {
						// no-op
					}
					else {
						_removeWithFunction(connectionsByElementId[elId], function(_c) {
							return _c[0].id == c.id;
						});
					}
				};
				
			removeConnection(1, ep[1], ep[1].anchor, sourceId, connection);
			removeConnection(0, ep[0], ep[0].anchor, targetId, connection);

            // remove from anchorLists
            var sEl = connection.sourceId,
                tEl = connection.targetId,
                sE =  connection.endpoints[0].id,
                tE = connection.endpoints[1].id,
                _remove = function(list, eId) {
                    if (list) {  // transient anchors dont get entries in this list.
                        var f = function(e) { return e[4] == eId; };
                        _removeWithFunction(list["top"], f);
                        _removeWithFunction(list["left"], f);
                        _removeWithFunction(list["bottom"], f);
                        _removeWithFunction(list["right"], f);
                    }
                };
            
            _remove(anchorLists[sEl], sE);
            _remove(anchorLists[tEl], tE);
            self.redraw(sEl);
            self.redraw(tEl);
		};
		this.add = function(endpoint, elementId) {
			_addToList(_amEndpoints, elementId, endpoint);
		};
		this.changeId = function(oldId, newId) {
			connectionsByElementId[newId] = connectionsByElementId[oldId];
			_amEndpoints[newId] = _amEndpoints[oldId];
			delete connectionsByElementId[oldId];
			delete _amEndpoints[oldId];	
		};
		this.getConnectionsFor = function(elementId) {
			return connectionsByElementId[elementId] || [];
		};
		this.getEndpointsFor = function(elementId) {
			return _amEndpoints[elementId] || [];
		};
		this.deleteEndpoint = function(endpoint) {
			_removeWithFunction(_amEndpoints[endpoint.elementId], function(e) {
				return e.id == endpoint.id;
			});
		};
		this.clearFor = function(elementId) {
			delete _amEndpoints[elementId];
			_amEndpoints[elementId] = [];
		};
        // updates the given anchor list by either updating an existing anchor's info, or adding it. this function
        // also removes the anchor from its previous list, if the edge it is on has changed.
        // all connections found along the way (those that are connected to one of the faces this function
        // operates on) are added to the connsToPaint list, as are their endpoints. in this way we know to repaint
        // them wthout having to calculate anything else about them.
        var _updateAnchorList = function(lists, theta, order, conn, aBoolean, otherElId, idx, reverse, edgeId, elId, connsToPaint, endpointsToPaint) {
            // first try to find the exact match, but keep track of the first index of a matching element id along the way.s
            var exactIdx = -1,
                firstMatchingElIdx = -1,
                endpoint = conn.endpoints[idx],
                endpointId = endpoint.id,
                oIdx = [1,0][idx],
                values = [ [ theta, order ], conn, aBoolean, otherElId, endpointId ],
                listToAddTo = lists[edgeId],
                listToRemoveFrom = endpoint._continuousAnchorEdge ? lists[endpoint._continuousAnchorEdge] : null;

            if (listToRemoveFrom) {
                var rIdx = _findWithFunction(listToRemoveFrom, function(e) { return e[4] == endpointId });
                if (rIdx != -1) {
                    listToRemoveFrom.splice(rIdx, 1);
                    // get all connections from this list
                    for (var i = 0; i < listToRemoveFrom.length; i++) {
                        _addWithFunction(connsToPaint, listToRemoveFrom[i][1], function(c) { return c.id == listToRemoveFrom[i][1].id });
                        _addWithFunction(endpointsToPaint, listToRemoveFrom[i][1].endpoints[idx], function(e) { return e.id == listToRemoveFrom[i][1].endpoints[idx].id });
                    }
                }
            }

            for (var i = 0; i < listToAddTo.length; i++) {
                if (idx == 1 && listToAddTo[i][3] === otherElId && firstMatchingElIdx == -1)
                    firstMatchingElIdx = i;
                _addWithFunction(connsToPaint, listToAddTo[i][1], function(c) { return c.id == listToAddTo[i][1].id });                
                _addWithFunction(endpointsToPaint, listToAddTo[i][1].endpoints[idx], function(e) { return e.id == listToAddTo[i][1].endpoints[idx].id });
            }
            if (exactIdx != -1) {
                listToAddTo[exactIdx] = values;
            }
            else {
                var insertIdx = reverse ? firstMatchingElIdx != -1 ? firstMatchingElIdx : 0 : listToAddTo.length; // of course we will get this from having looked through the array shortly.
                listToAddTo.splice(insertIdx, 0, values);
            }

            // store this for next time.
            endpoint._continuousAnchorEdge = edgeId;
        };
		this.redraw = function(elementId, ui, timestamp, offsetToUI) {
		
			if (!_suspendDrawing) {
				// get all the endpoints for this element
				var ep = _amEndpoints[elementId] || [],
					endpointConnections = connectionsByElementId[elementId] || [],
					connectionsToPaint = [],
					endpointsToPaint = [],
	                anchorsToUpdate = [];
	            
				timestamp = timestamp || _timestamp();
				// offsetToUI are values that would have been calculated in the dragManager when registering
				// an endpoint for an element that had a parent (somewhere in the hierarchy) that had been
				// registered as draggable.
				offsetToUI = offsetToUI || {left:0, top:0};
				if (ui) {
					ui = {
						left:ui.left + offsetToUI.left,
						top:ui.top + offsetToUI.top
					}
				}
					
				_updateOffset( { elId : elementId, offset : ui, recalc : false, timestamp : timestamp }); 
				// valid for one paint cycle.
				var myOffset = offsets[elementId],
	                myWH = sizes[elementId],
	                orientationCache = {};
				
				// actually, first we should compute the orientation of this element to all other elements to which
				// this element is connected with a continuous anchor (whether both ends of the connection have
				// a continuous anchor or just one)
	            //for (var i = 0; i < continuousAnchorConnections.length; i++) {
	            for (var i = 0; i < endpointConnections.length; i++) {
	                var conn = endpointConnections[i][0],
						sourceId = conn.sourceId,
	                    targetId = conn.targetId,
	                    sourceContinuous = conn.endpoints[0].anchor.isContinuous,
	                    targetContinuous = conn.endpoints[1].anchor.isContinuous;
	
	                if (sourceContinuous || targetContinuous) {
		                var oKey = sourceId + "_" + targetId,
		                    oKey2 = targetId + "_" + sourceId,
		                    o = orientationCache[oKey],
		                    oIdx = conn.sourceId == elementId ? 1 : 0;
	
		                if (sourceContinuous && !anchorLists[sourceId]) anchorLists[sourceId] = { top:[], right:[], bottom:[], left:[] };
		                if (targetContinuous && !anchorLists[targetId]) anchorLists[targetId] = { top:[], right:[], bottom:[], left:[] };
	
		                if (elementId != targetId) _updateOffset( { elId : targetId, timestamp : timestamp }); 
		                if (elementId != sourceId) _updateOffset( { elId : sourceId, timestamp : timestamp }); 
	
		                var td = _getCachedData(targetId),
							sd = _getCachedData(sourceId);
	
		                if (targetId == sourceId && (sourceContinuous || targetContinuous)) {
		                    // here we may want to improve this by somehow determining the face we'd like
						    // to put the connector on.  ideally, when drawing, the face should be calculated
						    // by determining which face is closest to the point at which the mouse button
							// was released.  for now, we're putting it on the top face.
		                    _updateAnchorList(anchorLists[sourceId], -Math.PI / 2, 0, conn, false, targetId, 0, false, "top", sourceId, connectionsToPaint, endpointsToPaint)
						}
		                else {
		                    if (!o) {
		                        o = calculateOrientation(sourceId, targetId, sd.o, td.o);
		                        orientationCache[oKey] = o;
		                        // this would be a performance enhancement, but the computed angles need to be clamped to
		                        //the (-PI/2 -> PI/2) range in order for the sorting to work properly.
		                    /*  orientationCache[oKey2] = {
		                            orientation:o.orientation,
		                            a:[o.a[1], o.a[0]],
		                            theta:o.theta + Math.PI,
		                            theta2:o.theta2 + Math.PI
		                        };*/
		                    }
		                    if (sourceContinuous) _updateAnchorList(anchorLists[sourceId], o.theta, 0, conn, false, targetId, 0, false, o.a[0], sourceId, connectionsToPaint, endpointsToPaint);
		                    if (targetContinuous) _updateAnchorList(anchorLists[targetId], o.theta2, -1, conn, true, sourceId, 1, true, o.a[1], targetId, connectionsToPaint, endpointsToPaint);
		                }
	
		                if (sourceContinuous) _addWithFunction(anchorsToUpdate, sourceId, function(a) { return a === sourceId; });
		                if (targetContinuous) _addWithFunction(anchorsToUpdate, targetId, function(a) { return a === targetId; });
		                _addWithFunction(connectionsToPaint, conn, function(c) { return c.id == conn.id; });
		                if ((sourceContinuous && oIdx == 0) || (targetContinuous && oIdx == 1))
		                	_addWithFunction(endpointsToPaint, conn.endpoints[oIdx], function(e) { return e.id == conn.endpoints[oIdx].id; });
		            }
	            }
				
				// place Endpoints whose anchors are continuous but have no Connections
				for (var i = 0; i < ep.length; i++) {
					if (ep[i].connections.length == 0 && ep[i].anchor.isContinuous) {
						if (!anchorLists[elementId]) anchorLists[elementId] = { top:[], right:[], bottom:[], left:[] };
						_updateAnchorList(anchorLists[elementId], -Math.PI / 2, 0, {endpoints:[ep[i], ep[i]], paint:function(){}}, false, elementId, 0, false, "top", elementId, connectionsToPaint, endpointsToPaint)
						_addWithFunction(anchorsToUpdate, elementId, function(a) { return a === elementId; })
					}
				}
	
	            // now place all the continuous anchors we need to;
	            for (var i = 0; i < anchorsToUpdate.length; i++) {
					placeAnchors(anchorsToUpdate[i], anchorLists[anchorsToUpdate[i]]);
				}
				
				// now that continuous anchors have been placed, paint all the endpoints for this element
	            // TODO performance: add the endpoint ids to a temp array, and then when iterating in the next
	            // loop, check that we didn't just paint that endpoint. we can probably shave off a few more milliseconds this way.
				for (var i = 0; i < ep.length; i++) {				
					ep[i].paint( { timestamp : timestamp, offset : myOffset, dimensions : myWH });
				}
	            // ... and any other endpoints we came across as a result of the continuous anchors.
	            for (var i = 0; i < endpointsToPaint.length; i++) {
					endpointsToPaint[i].paint( { timestamp : timestamp, offset : myOffset, dimensions : myWH });
				}
	
				// paint all the standard and "dynamic connections", which are connections whose other anchor is
				// static and therefore does need to be recomputed; we make sure that happens only one time.
	
				// TODO we could have compiled a list of these in the first pass through connections; might save some time.
				for (var i = 0; i < endpointConnections.length; i++) {
					var otherEndpoint = endpointConnections[i][1];
					if (otherEndpoint.anchor.constructor == DynamicAnchor) {			 							
						otherEndpoint.paint({ elementWithPrecedence:elementId });								
	                    _addWithFunction(connectionsToPaint, endpointConnections[i][0], function(c) { return c.id == endpointConnections[i][0].id; });
						// all the connections for the other endpoint now need to be repainted
						for (var k = 0; k < otherEndpoint.connections.length; k++) {
							if (otherEndpoint.connections[k] !== endpointConnections[i][0])							
	                            _addWithFunction(connectionsToPaint, otherEndpoint.connections[k], function(c) { return c.id == otherEndpoint.connections[k].id; });
						}
					} else if (otherEndpoint.anchor.constructor == Anchor) {					
	                    _addWithFunction(connectionsToPaint, endpointConnections[i][0], function(c) { return c.id == endpointConnections[i][0].id; });
					}
				}
				// paint current floating connection for this element, if there is one.
				var fc = floatingConnections[elementId];
				if (fc) 
					fc.paint({timestamp:timestamp, recalc:false, elId:elementId});
					
				// paint all the connections
				for (var i = 0; i < connectionsToPaint.length; i++) {
					connectionsToPaint[i].paint({elId:elementId, timestamp:timestamp, recalc:false});
				}
			}
		};
		this.rehomeEndpoint = function(currentId, element) {
			var eps = _amEndpoints[currentId] || [], //, 
				elementId = _currentInstance.getId(element);
			if (elementId !== currentId) {
				for (var i = 0; i < eps.length; i++) {
					self.add(eps[i], elementId);
				}
				eps.splice(0, eps.length);
			}
		};
	};
	_currentInstance.anchorManager = new AnchorManager();				
	_currentInstance.continuousAnchorFactory = {
		get:function(params) {
			var existing = continuousAnchors[params.elementId];
			if (!existing) {
				existing = {
					type:"Continuous",
					compute : function(params) {
						return continuousAnchorLocations[params.element.id] || [0,0];
					},
					getCurrentLocation : function(endpoint) {
						return continuousAnchorLocations[endpoint.id] || [0,0];
					},
					getOrientation : function(endpoint) {
						return continuousAnchorOrientations[endpoint.id] || [0,0];
					},
					isDynamic : true,
					isContinuous : true
				};
				continuousAnchors[params.elementId] = existing;
			}
			return existing;
		}
	};

	if (!jsPlumbAdapter.headless)
		_currentInstance.dragManager = jsPlumbAdapter.getDragManager(_currentInstance);

		/*
		 * Class: Connection
		 * The connecting line between two Endpoints.
		 */
		/*
		 * Function: Connection
		 * Connection constructor. You should not ever create one of these directly. If you make a call to jsPlumb.connect, all of
		 * the parameters that you pass in to that function will be passed to the Connection constructor; if your UI
		 * uses the various Endpoint-centric methods like addEndpoint/makeSource/makeTarget, along with drag and drop,
		 * then the parameters you set on those functions are translated and passed in to the Connection constructor. So
		 * you should check the documentation for each of those methods.
		 * 
		 * Parameters:
		 * 	source 	- either an element id, a selector for an element, or an Endpoint.
		 * 	target	- either an element id, a selector for an element, or an Endpoint
		 * 	scope	- scope descriptor for this connection. optional.
		 *  container - optional id or selector instructing jsPlumb where to attach all the elements it creates for this connection.  you should read the documentation for a full discussion of this.
		 *  detachable - optional, defaults to true. Defines whether or not the connection may be detached using the mouse.
		 *  endpoint - Optional. Endpoint definition to use for both ends of the connection.
		 *  endpoints - Optional. Array of two Endpoint definitions, one for each end of the Connection. This and 'endpoint' are mutually exclusive parameters.
		 *  endpointStyle - Optional. Endpoint style definition to use for both ends of the Connection.
		 *  endpointStyles - Optional. Array of two Endpoint style definitions, one for each end of the Connection. This and 'endpoint' are mutually exclusive parameters.
		 *  paintStyle - Parameters defining the appearance of the Connection. Optional; jsPlumb will use the defaults if you supply nothing here.
		 *  hoverPaintStyle - Parameters defining the appearance of the Connection when the mouse is hovering over it. Optional; jsPlumb will use the defaults if you supply nothing here (note that the default hoverPaintStyle is null).
		 *  cssClass - optional CSS class to set on the display element associated with this Connection.
		 *  hoverClass - optional CSS class to set on the display element associated with this Connection when it is in hover state.
		 *  overlays - Optional array of Overlay definitions to appear on this Connection.
		 *  drawEndpoints - if false, instructs jsPlumb to not draw the endpoints for this Connection.  Be careful with this: it only really works when you tell jsPlumb to attach elements to the document body. Read the documentation for a full discussion of this. 
		 *  parameters - Optional JS object containing parameters to set on the Connection. These parameters are then available via the getParameter method.
		 */
		var Connection = function(params) {
			var self = this, visible = true, _internalHover, _superClassHover;
			self.idPrefix = "_jsplumb_c_";
			self.defaultLabelLocation = 0.5;
			self.defaultOverlayKeys = ["Overlays", "ConnectionOverlays"];
			this.parent = params.parent;
			overlayCapableJsPlumbUIComponent.apply(this, arguments);
			// ************** get the source and target and register the connection. *******************
			
// VISIBILITY						
			/**
				Function:isVisible
				Returns whether or not the Connection is currently visible.
			*/
			this.isVisible = function() { return visible; };
			/**
				Function: setVisible
				Sets whether or not the Connection should be visible.

				Parameters:
					visible - boolean indicating desired visible state.
			*/
			this.setVisible = function(v) {
				visible = v;
				self[v ? "showOverlays" : "hideOverlays"]();
				if (self.connector && self.connector.canvas) self.connector.canvas.style.display = v ? "block" : "none";
				self.repaint();
			};
// END VISIBILITY						
		
// TYPE		
			
			this.getTypeDescriptor = function() { return "connection"; };
			this.getDefaultType = function() {
				return {
					parameters:{},
					scope:null,
					detachable:self._jsPlumb.Defaults.ConnectionsDetachable,
					rettach:self._jsPlumb.Defaults.ReattachConnections,
					paintStyle:self._jsPlumb.Defaults.PaintStyle || jsPlumb.Defaults.PaintStyle,
					connector:self._jsPlumb.Defaults.Connector || jsPlumb.Defaults.Connector,
					hoverPaintStyle:self._jsPlumb.Defaults.HoverPaintStyle || jsPlumb.Defaults.HoverPaintStyle,				
					overlays:self._jsPlumb.Defaults.ConnectorOverlays || jsPlumb.Defaults.ConnectorOverlays
				};
			};
			var superAt = this.applyType;
			this.applyType = function(t) {
				superAt(t);
				if (t.detachable != null) self.setDetachable(t.detachable);
				if (t.reattach != null) self.setReattach(t.reattach);
				if (t.scope) self.scope = t.scope;
				self.setConnector(t.connector);
			};			
// END TYPE

// HOVER			
			// override setHover to pass it down to the underlying connector
			_superClassHover = self.setHover;
			self.setHover = function(state) {
				var zi = _currentInstance.ConnectorZIndex || jsPlumb.Defaults.ConnectorZIndex;
				if (zi)
					self.connector.setZIndex(zi + (state ? 1 : 0));
				self.connector.setHover.apply(self.connector, arguments);				
				_superClassHover.apply(self, arguments);
			};
			
			_internalHover = function(state) {
				if (_connectionBeingDragged == null) {
					self.setHover(state, false);
				}
			};
// END HOVER

			/*
			 * Function: setConnector
			 * Sets the Connection's connector (eg "Bezier", "Flowchart", etc).  You pass a Connector definition into this method - the same
			 * thing that you would set as the 'connector' property on a jsPlumb.connect call.
			 * 
			 * Parameters:
			 * 	connector		-	Connector definition
			 */
			this.setConnector = function(connector, doNotRepaint) {
				if (self.connector != null) _removeElements(self.connector.getDisplayElements(), self.parent);
				var connectorArgs = { _jsPlumb:self._jsPlumb, parent:params.parent, 
					cssClass:params.cssClass, container:params.container, tooltip:self.tooltip
				};
				if (_isString(connector)) 
					this.connector = new jsPlumb.Connectors[renderMode][connector](connectorArgs); // lets you use a string as shorthand.
				else if (_isArray(connector)) {
					if (connector.length == 1)
						this.connector = new jsPlumb.Connectors[renderMode][connector[0]](connectorArgs);
					else
						this.connector = new jsPlumb.Connectors[renderMode][connector[0]](jsPlumb.extend(connector[1], connectorArgs));
				}
				self.canvas = self.connector.canvas;
				// binds mouse listeners to the current connector.
				_bindListeners(self.connector, self, _internalHover);
				
				// set z-index if it was set on Defaults.
				var zi = _currentInstance.ConnectorZIndex || jsPlumb.Defaults.ConnectorZIndex;
				if (zi)
					self.connector.setZIndex(zi);
					
				if (!doNotRepaint) self.repaint();
			};
			
// INITIALISATION CODE			
						
			this.source = _getElementObject(params.source);
			this.target = _getElementObject(params.target);
			// sourceEndpoint and targetEndpoint override source/target, if they are present. but 
			// source is not overridden if the Endpoint has declared it is not the final target of a connection;
			// instead we use the source that the Endpoint declares will be the final source element.
			if (params.sourceEndpoint) this.source = params.sourceEndpoint.endpointWillMoveTo || params.sourceEndpoint.getElement();			
			if (params.targetEndpoint) this.target = params.targetEndpoint.getElement();
			
			// if a new connection is the result of moving some existing connection, params.previousConnection
			// will have that Connection in it. listeners for the jsPlumbConnection event can look for that
			// member and take action if they need to.
			self.previousConnection = params.previousConnection;
						
			this.sourceId = _getAttribute(this.source, "id");
			this.targetId = _getAttribute(this.target, "id");
			this.scope = params.scope; // scope may have been passed in to the connect call. if it wasn't, we will pull it from the source endpoint, after having initialised the endpoints.			
			this.endpoints = [];
			this.endpointStyles = [];
			// wrapped the main function to return null if no input given. this lets us cascade defaults properly.
			var _makeAnchor = function(anchorParams, elementId) {
				return (anchorParams) ? _currentInstance.makeAnchor(anchorParams, elementId, _currentInstance) : null;
			},
			prepareEndpoint = function(existing, index, params, element, elementId, connectorPaintStyle, connectorHoverPaintStyle) {
				var e;
				if (existing) {
					self.endpoints[index] = existing;
					existing.addConnection(self);					
				} else {
					if (!params.endpoints) params.endpoints = [ null, null ];
					var ep = params.endpoints[index] 
					        || params.endpoint
							|| _currentInstance.Defaults.Endpoints[index]
							|| jsPlumb.Defaults.Endpoints[index]
							|| _currentInstance.Defaults.Endpoint
							|| jsPlumb.Defaults.Endpoint;

					if (!params.endpointStyles) params.endpointStyles = [ null, null ];
					if (!params.endpointHoverStyles) params.endpointHoverStyles = [ null, null ];
					var es = params.endpointStyles[index] || params.endpointStyle || _currentInstance.Defaults.EndpointStyles[index] || jsPlumb.Defaults.EndpointStyles[index] || _currentInstance.Defaults.EndpointStyle || jsPlumb.Defaults.EndpointStyle;
					// Endpoints derive their fillStyle from the connector's strokeStyle, if no fillStyle was specified.
					if (es.fillStyle == null && connectorPaintStyle != null)
						es.fillStyle = connectorPaintStyle.strokeStyle;
					
					// TODO: decide if the endpoint should derive the connection's outline width and color.  currently it does:
					//*
					if (es.outlineColor == null && connectorPaintStyle != null) 
						es.outlineColor = connectorPaintStyle.outlineColor;
					if (es.outlineWidth == null && connectorPaintStyle != null) 
						es.outlineWidth = connectorPaintStyle.outlineWidth;
					//*/
					
					var ehs = params.endpointHoverStyles[index] || params.endpointHoverStyle || _currentInstance.Defaults.EndpointHoverStyles[index] || jsPlumb.Defaults.EndpointHoverStyles[index] || _currentInstance.Defaults.EndpointHoverStyle || jsPlumb.Defaults.EndpointHoverStyle;
					// endpoint hover fill style is derived from connector's hover stroke style.  TODO: do we want to do this by default? for sure?
					if (connectorHoverPaintStyle != null) {
						if (ehs == null) ehs = {};
						if (ehs.fillStyle == null) {
							ehs.fillStyle = connectorHoverPaintStyle.strokeStyle;
						}
					}
					var a = params.anchors ? params.anchors[index] : 
						params.anchor ? params.anchor :
						_makeAnchor(_currentInstance.Defaults.Anchors[index], elementId) || 
						_makeAnchor(jsPlumb.Defaults.Anchors[index], elementId) || 
						_makeAnchor(_currentInstance.Defaults.Anchor, elementId) || 
						_makeAnchor(jsPlumb.Defaults.Anchor, elementId),					
					u = params.uuids ? params.uuids[index] : null;
					e = _newEndpoint({ 
						paintStyle : es,  hoverPaintStyle:ehs,  endpoint : ep,  connections : [ self ], 
						uuid : u,  anchor : a,  source : element, scope  : params.scope, container:params.container,
						reattach:params.reattach || _currentInstance.Defaults.ReattachConnections,
						detachable:params.detachable || _currentInstance.Defaults.ConnectionsDetachable
					});
					self.endpoints[index] = e;
					
					if (params.drawEndpoints === false) e.setVisible(false, true, true);
										
				}
				return e;
			};					

			var eS = prepareEndpoint(params.sourceEndpoint, 0, params, self.source,
									 self.sourceId, params.paintStyle, params.hoverPaintStyle);			
			if (eS) _addToList(endpointsByElement, this.sourceId, eS);						
			var eT = prepareEndpoint(params.targetEndpoint, 1, params, self.target, 
									 self.targetId, params.paintStyle, params.hoverPaintStyle);
			if (eT) _addToList(endpointsByElement, this.targetId, eT);
			// if scope not set, set it to be the scope for the source endpoint.
			if (!this.scope) this.scope = this.endpoints[0].scope;		
			
			// if delete endpoints on detach, keep a record of just exactly which endpoints they are.
			self.endpointsToDeleteOnDetach = [null, null];
			if (params.deleteEndpointsOnDetach) {
				if (params.sourceIsNew) self.endpointsToDeleteOnDetach[0] = self.endpoints[0];
				if (params.targetIsNew) self.endpointsToDeleteOnDetach[1] = self.endpoints[1];
			}
						
			self.setConnector(this.endpoints[0].connector || 
							  this.endpoints[1].connector || 
							  params.connector || 
							  _currentInstance.Defaults.Connector || 
							  jsPlumb.Defaults.Connector, true);							  							  		
			
			this.setPaintStyle(this.endpoints[0].connectorStyle || 
							   this.endpoints[1].connectorStyle || 
							   params.paintStyle || 
							   _currentInstance.Defaults.PaintStyle || 
							   jsPlumb.Defaults.PaintStyle, true);
						
			this.setHoverPaintStyle(this.endpoints[0].connectorHoverStyle || 
									this.endpoints[1].connectorHoverStyle || 
									params.hoverPaintStyle || 
									_currentInstance.Defaults.HoverPaintStyle || 
									jsPlumb.Defaults.HoverPaintStyle, true);
			
			this.paintStyleInUse = this.getPaintStyle();
			
			_updateOffset( { elId : this.sourceId, timestamp:_suspendedAt });
			_updateOffset( { elId : this.targetId, timestamp:_suspendedAt });
			
			// paint the endpoints
			var myOffset = offsets[this.sourceId], myWH = sizes[this.sourceId],
				otherOffset = offsets[this.targetId],
				otherWH = sizes[this.targetId],
				initialTimestamp = _suspendedAt || _timestamp(),
				anchorLoc = this.endpoints[0].anchor.compute( {
					xy : [ myOffset.left, myOffset.top ], wh : myWH, element : this.endpoints[0],
					elementId:this.endpoints[0].elementId,
					txy : [ otherOffset.left, otherOffset.top ], twh : otherWH, tElement : this.endpoints[1],
					timestamp:initialTimestamp
				});

			this.endpoints[0].paint( { anchorLoc : anchorLoc, timestamp:initialTimestamp });

			anchorLoc = this.endpoints[1].anchor.compute( {
				xy : [ otherOffset.left, otherOffset.top ], wh : otherWH, element : this.endpoints[1],
				elementId:this.endpoints[1].elementId,				
				txy : [ myOffset.left, myOffset.top ], twh : myWH, tElement : this.endpoints[0],
				timestamp:initialTimestamp				
			});
			this.endpoints[1].paint({ anchorLoc : anchorLoc, timestamp:initialTimestamp });
									
// END INITIALISATION CODE			
			
// DETACHABLE 				
            var _detachable = _currentInstance.Defaults.ConnectionsDetachable;
            if (params.detachable === false) _detachable = false;
            if(self.endpoints[0].connectionsDetachable === false) _detachable = false;
            if(self.endpoints[1].connectionsDetachable === false) _detachable = false;
			/*
                Function: isDetachable
                Returns whether or not this connection can be detached from its target/source endpoint.  by default this
                is false; use it in conjunction with the 'reattach' parameter.
             */
            this.isDetachable = function() {
                return _detachable === true;
            };
            /*
                Function: setDetachable
                Sets whether or not this connection is detachable.
             */
            this.setDetachable = function(detachable) {
              _detachable = detachable === true;
            };
// END DETACHABLE

// REATTACH
			var _reattach = params.reattach ||
				self.endpoints[0].reattachConnections ||
				self.endpoints[1].reattachConnections ||
				_currentInstance.Defaults.ReattachConnections;
            
			//if (params.reattach === false) _reattach = false;
            
			//if(self.endpoints[0].reattachConnections === false) _reattach = false;
            //if(self.endpoints[1].reattachConnections === false) _reattach = false;
			/*
                Function: isReattach
                Returns whether or not this connection will be reattached after having been detached via the mouse and dropped.  by default this
                is false; use it in conjunction with the 'detachable' parameter.
             */
            this.isReattach = function() {
                return _reattach === true;
            };
            /*
                Function: setReattach
                Sets whether or not this connection will reattach after having been detached via the mouse and dropped.
             */
            this.setReattach = function(reattach) {
              _reattach = reattach === true;
            };

// END REATTACH
			
// COST + DIRECTIONALITY
			// if cost not supplied, try to inherit from source endpoint
			var _cost = params.cost || self.endpoints[0].getConnectionCost();			
			self.getCost = function() { return _cost; };
			self.setCost = function(c) { _cost = c; };			
			var _bidirectional = !(params.bidirectional === false);
			// inherit bidirectional flag if set no source endpoint
            if (params.bidirectional == null) _bidirectional = self.endpoints[0].areConnectionsBidirectional();
			self.isBidirectional = function() { return _bidirectional; };
// END COST + DIRECTIONALITY
                        
// PARAMETERS						
			// merge all the parameters objects into the connection.  parameters set
			// on the connection take precedence; then target endpoint params, then
			// finally source endpoint params.
			// TODO jsPlumb.extend could be made to take more than two args, and it would
			// apply the second through nth args in order.
			var _p = jsPlumb.extend({}, this.endpoints[0].getParameters());
			jsPlumb.extend(_p, this.endpoints[1].getParameters());
			jsPlumb.extend(_p, self.getParameters());
			self.setParameters(_p);
// END PARAMETERS
						
// MISCELLANEOUS			
			/**
			 * implementation of abstract method in jsPlumbUtil.EventGenerator
			 * @return list of attached elements. in our case, a list of Endpoints.
			 */
			this.getAttachedElements = function() {
				return self.endpoints;
			};
			
			/**
			 * changes the parent element of this connection to newParent.  not exposed for the public API.
			 */
			this.moveParent = function(newParent) {
				var jpcl = jsPlumb.CurrentLibrary, curParent = jpcl.getParent(self.connector.canvas);				
				if (self.connector.bgCanvas) {
				    jpcl.removeElement(self.connector.bgCanvas, curParent);
				    jpcl.appendElement(self.connector.bgCanvas, newParent);
                }
				jpcl.removeElement(self.connector.canvas, curParent);
				jpcl.appendElement(self.connector.canvas, newParent);                
                // this only applies for DOMOverlays
				for (var i = 0; i < self.overlays.length; i++) {
                    if (self.overlays[i].isAppendedAtTopLevel) {
					    jpcl.removeElement(self.overlays[i].canvas, curParent);
					    jpcl.appendElement(self.overlays[i].canvas, newParent);
					    if (self.overlays[i].reattachListeners) 
					    	self.overlays[i].reattachListeners(self.connector);
                    }
				}
				if (self.connector.reattachListeners)		// this is for SVG/VML; change an element's parent and you have to reinit its listeners.
					self.connector.reattachListeners();     // the Canvas implementation doesn't have to care about this
			};
		    
// END MISCELLANEOUS

// PAINTING

			/*
			 * Paints the Connection.  Not exposed for public usage. 
			 * 
			 * Parameters:
			 * 	elId - Id of the element that is in motion.
			 * 	ui - current library's event system ui object (present if we came from a drag to get here).
			 *  recalc - whether or not to recalculate all anchors etc before painting. 
			 *  timestamp - timestamp of this paint.  If the Connection was last painted with the same timestamp, it does not paint again.
			 */
			var lastPaintedAt = null;			
			this.paint = function(params) {
				
				if (visible) {
						
					params = params || {};
					var elId = params.elId, ui = params.ui, recalc = params.recalc, timestamp = params.timestamp,
						// if the moving object is not the source we must transpose the two references.
						swap = false,
						tId = swap ? this.sourceId : this.targetId, sId = swap ? this.targetId : this.sourceId,
						tIdx = swap ? 0 : 1, sIdx = swap ? 1 : 0;

					if (timestamp == null || timestamp != lastPaintedAt) {
						var sourceInfo = _updateOffset( { elId : elId, offset : ui, recalc : recalc, timestamp : timestamp }),
							targetInfo = _updateOffset( { elId : tId, timestamp : timestamp }); // update the target if this is a forced repaint. otherwise, only the source has been moved.
						
						var sE = this.endpoints[sIdx], tE = this.endpoints[tIdx],
							sAnchorP = sE.anchor.getCurrentLocation(sE),				
							tAnchorP = tE.anchor.getCurrentLocation(tE);
									
						/* paint overlays*/
						var maxSize = 0;
						for ( var i = 0; i < self.overlays.length; i++) {
							var o = self.overlays[i];
							if (o.isVisible()) maxSize = Math.max(maxSize, o.computeMaxSize());
						}
		
						var dim = this.connector.compute(
							sAnchorP,
							tAnchorP, 
							this.endpoints[sIdx],
							this.endpoints[tIdx],
							this.endpoints[sIdx].anchor,
							this.endpoints[tIdx].anchor, 
							self.paintStyleInUse.lineWidth,
							maxSize,
							sourceInfo,
							targetInfo );
												
						self.connector.paint(dim, self.paintStyleInUse);
						
						/* paint overlays*/
						for ( var i = 0; i < self.overlays.length; i++) {
							var o = self.overlays[i];
							if (o.isVisible) self.overlayPlacements[i] = o.draw(self.connector, self.paintStyleInUse, dim, timestamp);
						}
					}
					lastPaintedAt = timestamp;						
				}		
			};			

			/*
			 * Function: repaint
			 * Repaints the Connection.
			 */
			this.repaint = function(params) {
				params = params || {};
                var recalc = !(params.recalc === false);
				this.paint({ elId : this.sourceId, recalc : recalc, timestamp:params.timestamp });
			};
			
			// the very last thing we do is check to see if a 'type' was supplied in the params
			var _type = params.type || self.endpoints[0].connectionType || self.endpoints[1].connectionType;
			if (_type)
				self.addType(_type);
			
// END PAINTING

// ***************************** PLACEHOLDERS FOR NATURAL DOCS *************************************************
			/*
			 * Function: bind
			 * Bind to an event on the Connection.  
			 * 
			 * Parameters:
			 * 	event - the event to bind.  Available events on a Connection are:
			 *         - *click*						:	notification that a Connection was clicked.  
			 *         - *dblclick*						:	notification that a Connection was double clicked.
			 *         - *mouseenter*					:	notification that the mouse is over a Connection. 
			 *         - *mouseexit*					:	notification that the mouse exited a Connection.
			 * 		   - *contextmenu*                  :   notification that the user right-clicked on the Connection.
			 *         
			 *  callback - function to callback. This function will be passed the Connection that caused the event, and also the original event.    
			 */
			
			/*
		     * Function: setPaintStyle
		     * Sets the Connection's paint style and then repaints the Connection.
		     * 
		     * Parameters:
		     * 	style - Style to use.
		     */

		     /*
		     * Function: getPaintStyle
		     * Gets the Connection's paint style. This is not necessarily the paint style in use at the time;
		     * this is the paint style for the connection when the mouse it not hovering over it.
		     */
			
			/*
		     * Function: setHoverPaintStyle
		     * Sets the paint style to use when the mouse is hovering over the Connection. This is null by default.
		     * The hover paint style is applied as extensions to the paintStyle; it does not entirely replace
		     * it.  This is because people will most likely want to change just one thing when hovering, say the
		     * color for example, but leave the rest of the appearance the same.
		     * 
		     * Parameters:
		     * 	style - Style to use when the mouse is hovering.
		     *  doNotRepaint - if true, the Connection will not be repainted.  useful when setting things up initially.
		     */
			
			/*
		     * Function: setHover
		     * Sets/unsets the hover state of this Connection.
		     * 
		     * Parameters:
		     * 	hover - hover state boolean
		     * 	ignoreAttachedElements - if true, does not notify any attached elements of the change in hover state.  used mostly to avoid infinite loops.
		     */

		     /*
		     * Function: getParameter
		     * Gets the named parameter; returns null if no parameter with that name is set. Parameter values may have been supplied to a 'connect' or 'addEndpoint' call (connections made with the mouse get a copy of all parameters set on each of their Endpoints), or the parameter value may have been set with setParameter.
		     *
		     * Parameters:
		     *   key - Parameter name.
		     */

		     /*
		     * Function: setParameter
		     * Sets the named parameter to the given value.
		     *
		     * Parameters:
		     *   key - Parameter name.
		     *   value - Parameter value.
		     */
			 
			 /*
			 * Property: connector
			 * The underlying Connector for this Connection (eg. a Bezier connector, straight line connector, flowchart connector etc)
			 */
			 
			 /*
			 * Property: sourceId
			 * Id of the source element in the connection.
			 */
			/*
			 * Property: targetId
			 * Id of the target element in the connection.
			 */
			/*
			 * Property: scope
			 * Optional scope descriptor for the connection.
			 */
			/*
			 * Property: endpoints
			 * Array of [source, target] Endpoint objects.
			 */
			/*
			 *	Property: source
			 *	The source element for this Connection.
			 */
			/*
			 *	Property: target
			 *	The target element for this Connection.
			 */
			/*
			 * Property: overlays
			 * List of Overlays for this component.
			 */
			/*
			 * Function: addOverlay
			 * Adds an Overlay to the Connection.
			 * 
			 * Parameters:
			 * 	overlay - Overlay to add.
			 */
			/*
			 * Function: getOverlay
			 * Gets an overlay, by ID. Note: by ID.  You would pass an 'id' parameter
			 * in to the Overlay's constructor arguments, and then use that to retrieve
			 * it via this method.
			 */
			/*
			* Function: getOverlays
			* Gets all the overlays for this component.
			*/
			/*
			 * Function: hideOverlay
			 * Hides the overlay specified by the given id.
			 */
			/*
			 * Function: hideOverlays
			 * Hides all Overlays
			 */
			/*
			 * Function: showOverlay
			 * Shows the overlay specified by the given id.
			 */
			/*
			 * Function: showOverlays
			 * Shows all Overlays 
			 */
			/**
			 * Function: removeAllOverlays
			 * Removes all overlays from the Connection, and then repaints.
			 */
			/**
			 * Function: removeOverlay
			 * Removes an overlay by ID.  Note: by ID.  this is a string you set in the overlay spec.
			 * Parameters:
			 * overlayId - id of the overlay to remove.
			 */
			/**
			 * Function: removeOverlays
			 * Removes a set of overlays by ID.  Note: by ID.  this is a string you set in the overlay spec.
			 * Parameters:
			 * overlayIds - this function takes an arbitrary number of arguments, each of which is a single overlay id.
			 */
			/*
			 * Function: setLabel
			 * Sets the Connection's label.  
			 * 
			 * Parameters:
			 * 	l	- label to set. May be a String, a Function that returns a String, or a params object containing { "label", "labelStyle", "location", "cssClass" }.  Note that this uses innerHTML on the label div, so keep
         * that in mind if you need escaped HTML.
			 */
			/*
				Function: getLabel
				Returns the label text for this Connection (or a function if you are labelling with a function).
				This does not return the overlay itself; this is a convenience method which is a pair with
				setLabel; together they allow you to add and access a Label Overlay without having to create the
				Overlay object itself.  For access to the underlying label overlay that jsPlumb has created,
				use getLabelOverlay.
			*/
			/*
				Function: getLabelOverlay
				Returns the underlying internal label overlay, which will exist if you specified a label on
				a connect call, or have called setLabel at any stage.   
			*/
			
// ***************************** END OF PLACEHOLDERS FOR NATURAL DOCS *************************************************												

			
		}; // END Connection class
		
// ENDPOINT HELPER FUNCTIONS
		var _makeConnectionDragHandler = function(placeholder) {
            var stopped = false;
            return {
                drag : function() {
                    if (stopped) {
                        stopped = false;
                        return true;
                    }
                    var _ui = jsPlumb.CurrentLibrary.getUIPosition(arguments, _currentInstance.getZoom()),
                        el = placeholder.element;
            
                    if (el) {
                        jsPlumb.CurrentLibrary.setOffset(el, _ui);
                        _draw(_getElementObject(el), _ui);
                    }
                },
                stopDrag : function() {
                    stopped = true;
                }
            };
		};		
		
		var _makeFloatingEndpoint = function(paintStyle, referenceAnchor, endpoint, referenceCanvas, sourceElement) {			
				var floatingAnchor = new FloatingAnchor( { reference : referenceAnchor, referenceCanvas : referenceCanvas });
        //setting the scope here should not be the way to fix that mootools issue.  it should be fixed by not
        // adding the floating endpoint as a droppable.  that makes more sense anyway!
        return _newEndpoint({ paintStyle : paintStyle, endpoint : endpoint, anchor : floatingAnchor, source : sourceElement, scope:"__floating" });
		};
		
		/**
		 * creates a placeholder div for dragging purposes, adds it to the DOM, and pre-computes its offset.
		 */
		var _makeDraggablePlaceholder = function(placeholder, parent) {
			var n = document.createElement("div");
			n.style.position = "absolute";
			var placeholderDragElement = _getElementObject(n);
			_appendElement(n, parent);
			var id = _getId(placeholderDragElement);
			_updateOffset( { elId : id });
			// create and assign an id, and initialize the offset.
			placeholder.id = id;
			placeholder.element = placeholderDragElement;
		};

		/*
		 * Class: Endpoint 
		 * 
		 * Models an endpoint. Can have 1 to 'maxConnections' Connections emanating from it (set maxConnections to -1 
		 * to allow unlimited).  Typically, if you use 'jsPlumb.connect' to programmatically connect two elements, you won't
		 * actually deal with the underlying Endpoint objects.  But if you wish to support drag and drop Connections, one of the ways you
		 * do so is by creating and registering Endpoints using 'jsPlumb.addEndpoint', and marking these Endpoints as 'source' and/or
		 * 'target' Endpoints for Connections.  
		 * 
		 * 
		 */

		/*
		 * Function: Endpoint 
		 * 
		 * Endpoint constructor.
		 * 
		 * Parameters: 
		 * anchor - definition of the Anchor for the endpoint.  You can include one or more Anchor definitions here; if you include more than one, jsPlumb creates a 'dynamic' Anchor, ie. an Anchor which changes position relative to the other elements in a Connection.  Each Anchor definition can be either a string nominating one of the basic Anchors provided by jsPlumb (eg. "TopCenter"), or a four element array that designates the Anchor's location and orientation (eg, and this is equivalent to TopCenter, [ 0.5, 0, 0, -1 ]).  To provide more than one Anchor definition just put them all in an array. You can mix string definitions with array definitions.
		 * endpoint - optional Endpoint definition. This takes the form of either a string nominating one of the basic Endpoints provided by jsPlumb (eg. "Rectangle"), or an array containing [name,params] for those cases where you don't wish to use the default values, eg. [ "Rectangle", { width:5, height:10 } ].
		 * enabled - optional, defaults to true. Indicates whether or not the Endpoint should be enabled for mouse events (drag/drop).
		 * paintStyle - endpoint style, a js object. may be null. 
		 * hoverPaintStyle - style to use when the mouse is hovering over the Endpoint. A js object. may be null; defaults to null.
		 * cssClass - optional CSS class to set on the display element associated with this Endpoint.
		 * hoverClass - optional CSS class to set on the display element associated with this Endpoint when it is in hover state.
		 * source - element the Endpoint is attached to, of type String (an element id) or element selector. Required.
		 * canvas - canvas element to use. may be, and most often is, null.
		 * container - optional id or selector instructing jsPlumb where to attach the element it creates for this endpoint.  you should read the documentation for a full discussion of this.
		 * connections - optional list of Connections to configure the Endpoint with. 
		 * isSource - boolean. indicates the endpoint can act as a source of new connections. Optional; defaults to false.
		 * maxConnections - integer; defaults to 1.  a value of -1 means no upper limit. 
		 * dragOptions - if isSource is set to true, you can supply arguments for the underlying library's drag method. Optional; defaults to null. 
		 * connectorStyle - if isSource is set to true, this is the paint style for Connections from this Endpoint. Optional; defaults to null.
		 * connectorHoverStyle - if isSource is set to true, this is the hover paint style for Connections from this Endpoint. Optional; defaults to null.
		 * connector - optional Connector type to use.  Like 'endpoint', this may be either a single string nominating a known Connector type (eg. "Bezier", "Straight"), or an array containing [name, params], eg. [ "Bezier", { curviness:160 } ].
		 * connectorOverlays - optional array of Overlay definitions that will be applied to any Connection from this Endpoint. 
		 * connectorClass - optional CSS class to set on Connections emanating from this Endpoint.
		 * connectorHoverClass - optional CSS class to set on to set on Connections emanating from this Endpoint when they are in hover state.		 
		 * connectionsDetachable - optional, defaults to true. Sets whether connections to/from this Endpoint should be detachable or not.
		 * isTarget - boolean. indicates the endpoint can act as a target of new connections. Optional; defaults to false.
		 * dropOptions - if isTarget is set to true, you can supply arguments for the underlying library's drop method with this parameter. Optional; defaults to null. 
		 * reattach - optional boolean that determines whether or not the Connections reattach after they have been dragged off an Endpoint and left floating. defaults to false: Connections dropped in this way will just be deleted.
		 * parameters - Optional JS object containing parameters to set on the Endpoint. These parameters are then available via the getParameter method.  When a connection is made involving this Endpoint, the parameters from this Endpoint are copied into that Connection. Source Endpoint parameters override target Endpoint parameters if they both have a parameter with the same name.
		 */
		var Endpoint = function(params) {
			var self = this;
			self.idPrefix = "_jsplumb_e_";			
			self.defaultLabelLocation = [ 0.5, 0.5 ];
			self.defaultOverlayKeys = ["Overlays", "EndpointOverlays"];
			this.parent = params.parent;
			overlayCapableJsPlumbUIComponent.apply(this, arguments);
			params = params || {};
			
// TYPE		
			
			this.getTypeDescriptor = function() { return "endpoint"; };
			this.getDefaultType = function() {								
				return {
					parameters:{},
					scope:null,
					maxConnections:self._jsPlumb.Defaults.MaxConnections,
					paintStyle:self._jsPlumb.Defaults.EndpointStyle || jsPlumb.Defaults.EndpointStyle,
					endpoint:self._jsPlumb.Defaults.Endpoint || jsPlumb.Defaults.Endpoint,
					hoverPaintStyle:self._jsPlumb.Defaults.EndpointHoverStyle || jsPlumb.Defaults.EndpointHoverStyle,				
					overlays:self._jsPlumb.Defaults.EndpointOverlays || jsPlumb.Defaults.EndpointOverlays,
					connectorStyle:params.connectorStyle,				
					connectorHoverStyle:params.connectorHoverStyle,
					connectorClass:params.connectorClass,
					connectorHoverClass:params.connectorHoverClass,
					connectorOverlays:params.connectorOverlays,
					connector:params.connector,
					connectorTooltip:params.connectorTooltip
				};
			};
			var superAt = this.applyType;
			this.applyType = function(t) {
				superAt(t);
				if (t.maxConnections != null) _maxConnections = t.maxConnections;
				if (t.scope) self.scope = t.scope;
				self.connectorStyle = t.connectorStyle;
				self.connectorHoverStyle = t.connectorHoverStyle;
				self.connectorOverlays = t.connectorOverlays;
				self.connector = t.connector;
				self.connectorTooltip = t.connectorTooltip;
				self.connectionType = t.connectionType;
				self.connectorClass = t.connectorClass;
				self.connectorHoverClass = t.connectorHoverClass;
			};			
// END TYPE
		
			var visible = true, __enabled = !(params.enabled === false);
			/*
				Function: isVisible
				Returns whether or not the Endpoint is currently visible.
			*/
			this.isVisible = function() { return visible; };
			/*
				Function: setVisible
				Sets whether or not the Endpoint is currently visible.

				Parameters:
					visible - whether or not the Endpoint should be visible.
					doNotChangeConnections - Instructs jsPlumb to not pass the visible state on to any attached Connections. defaults to false.
					doNotNotifyOtherEndpoint - Instructs jsPlumb to not pass the visible state on to Endpoints at the other end of any attached Connections. defaults to false. 
			*/
			this.setVisible = function(v, doNotChangeConnections, doNotNotifyOtherEndpoint) {
				visible = v;
				if (self.canvas) self.canvas.style.display = v ? "block" : "none";
				self[v ? "showOverlays" : "hideOverlays"]();
				if (!doNotChangeConnections) {
					for (var i = 0; i < self.connections.length; i++) {
						self.connections[i].setVisible(v);
						if (!doNotNotifyOtherEndpoint) {
							var oIdx = self === self.connections[i].endpoints[0] ? 1 : 0;
							// only change the other endpoint if this is its only connection.
							if (self.connections[i].endpoints[oIdx].connections.length == 1) self.connections[i].endpoints[oIdx].setVisible(v, true, true);
						}
					}
				}
			};			

			/*
				Function: isEnabled
				Returns whether or not the Endpoint is enabled for drag/drop connections.
			*/
			this.isEnabled = function() { return __enabled; };

			/*
				Function: setEnabled
				Sets whether or not the Endpoint is enabled for drag/drop connections.
			*/
			this.setEnabled = function(e) { __enabled = e; };

			var _element = params.source,  _uuid = params.uuid, floatingEndpoint = null,  inPlaceCopy = null;
			if (_uuid) endpointsByUUID[_uuid] = self;
			var _elementId = _getAttribute(_element, "id");
			this.elementId = _elementId;
			this.element = _element;
			
			var _connectionCost = params.connectionCost;
			this.getConnectionCost = function() { return _connectionCost; };
			this.setConnectionCost = function(c) {
				_connectionCost = c; 
			};
			
			var _connectionsBidirectional = params.connectionsBidirectional === false ? false : true;
			this.areConnectionsBidirectional = function() { return _connectionsBidirectional; };
			this.setConnectionsBidirectional = function(b) { _connectionsBidirectional = b; };
						
			self.anchor = params.anchor ? _currentInstance.makeAnchor(params.anchor, _elementId, _currentInstance) : params.anchors ? _currentInstance.makeAnchor(params.anchors, _elementId, _currentInstance) : _currentInstance.makeAnchor(_currentInstance.Defaults.Anchor || "TopCenter", _elementId, _currentInstance);
				
			// ANCHOR MANAGER
			if (!params._transient) // in place copies, for example, are transient.  they will never need to be retrieved during a paint cycle, because they dont move, and then they are deleted.
				_currentInstance.anchorManager.add(self, _elementId);

			var _endpoint = null, originalEndpoint = null;
			this.setEndpoint = function(ep) {
				var endpointArgs = {
	                _jsPlumb:self._jsPlumb,
	                parent:params.parent,
	                container:params.container,
	                tooltip:params.tooltip,
	                connectorTooltip:params.connectorTooltip,
	                endpoint:self
	            };
				if (_isString(ep)) 
					_endpoint = new jsPlumb.Endpoints[renderMode][ep](endpointArgs);
				else if (_isArray(ep)) {
					endpointArgs = jsPlumb.extend(ep[1], endpointArgs);
					_endpoint = new jsPlumb.Endpoints[renderMode][ep[0]](endpointArgs);
				}
				else {
					_endpoint = ep.clone();
				}

				// assign a clone function using a copy of endpointArgs. this is used when a drag starts: the endpoint that was dragged is cloned,
				// and the clone is left in its place while the original one goes off on a magical journey. 
				// the copy is to get around a closure problem, in which endpointArgs ends up getting shared by
				// the whole world.
				var argsForClone = jsPlumb.extend({}, endpointArgs);						
				_endpoint.clone = function() {
					var o = new Object();
					_endpoint.constructor.apply(o, [argsForClone]);
					return o;
				};

				self.endpoint = _endpoint;
				self.type = self.endpoint.type;
			};
			 
			this.setEndpoint(params.endpoint || _currentInstance.Defaults.Endpoint || jsPlumb.Defaults.Endpoint || "Dot");							
			originalEndpoint = _endpoint;

			// override setHover to pass it down to the underlying endpoint
			var _sh = self.setHover;
			self.setHover = function() {
				self.endpoint.setHover.apply(self.endpoint, arguments);
				_sh.apply(self, arguments);
			};
            // endpoint delegates to first connection for hover, if there is one.
            var internalHover = function(state) {
              if (self.connections.length > 0)
                self.connections[0].setHover(state, false);
              else
                self.setHover(state);
            };
			
			// bind listeners from endpoint to self, with the internal hover function defined above.
            _bindListeners(self.endpoint, self, internalHover);
			
			this.setPaintStyle(params.paintStyle || 
							   params.style || 
							   _currentInstance.Defaults.EndpointStyle || 
							   jsPlumb.Defaults.EndpointStyle, true);
			this.setHoverPaintStyle(params.hoverPaintStyle || 
									_currentInstance.Defaults.EndpointHoverStyle || 
									jsPlumb.Defaults.EndpointHoverStyle, true);
			this.paintStyleInUse = this.getPaintStyle();
			var originalPaintStyle = this.getPaintStyle();
			this.connectorStyle = params.connectorStyle;
			this.connectorHoverStyle = params.connectorHoverStyle;
			this.connectorOverlays = params.connectorOverlays;
			this.connector = params.connector;
			this.connectorTooltip = params.connectorTooltip;
			this.connectorClass = params.connectorClass;
			this.connectorHoverClass = params.connectorHoverClass;	
			this.isSource = params.isSource || false;
			this.isTarget = params.isTarget || false;
			
			var _maxConnections = params.maxConnections || _currentInstance.Defaults.MaxConnections; // maximum number of connections this endpoint can be the source of.
						
			this.getAttachedElements = function() {
				return self.connections;
			};
						
			this.canvas = this.endpoint.canvas;			
			this.connections = params.connections || [];
			
			this.scope = params.scope || DEFAULT_SCOPE;
			this.connectionType = params.connectionType;
			this.timestamp = null;
			//self.isReattach = params.reattach || false;
			self.reattachConnections = params.reattach || _currentInstance.Defaults.ReattachConnections;
			//self.isReattach = params.reattach || false;
            self.connectionsDetachable = _currentInstance.Defaults.ConnectionsDetachable;
            if (params.connectionsDetachable === false || params.detachable === false)
                self.connectionsDetachable = false;
			var dragAllowedWhenFull = params.dragAllowedWhenFull || true;
			
			if (params.onMaxConnections)
				self.bind("maxConnections", params.onMaxConnections);

			this.computeAnchor = function(params) {
				return self.anchor.compute(params);
			};
			/*
			 * Function: addConnection
			 *   Adds a Connection to this Endpoint.
			 *   
			 * Parameters:
			 *   connection - the Connection to add.
			 */
			this.addConnection = function(connection) {
				self.connections.push(connection);
			};			
			/*
			 * Function: detach
			 *   Detaches the given Connection from this Endpoint.
			 *   
			 * Parameters:
			 *   connection - the Connection to detach.
			 *   ignoreTarget - optional; tells the Endpoint to not notify the Connection target that the Connection was detached.  The default behaviour is to notify the target.
			 */
			this.detach = function(connection, ignoreTarget, forceDetach, fireEvent, originalEvent) {
				var idx = _findWithFunction(self.connections, function(c) { return c.id == connection.id}), 
					actuallyDetached = false;
                fireEvent = (fireEvent !== false);
				if (idx >= 0) {		
					// 1. does the connection have a before detach (note this also checks jsPlumb's bound
					// detach handlers; but then Endpoint's check will, too, hmm.)
					if (forceDetach || connection._forceDetach || connection.isDetachable() || connection.isDetachAllowed(connection)) {
						// get the target endpoint
						var t = connection.endpoints[0] == self ? connection.endpoints[1] : connection.endpoints[0];
						// it would be nice to check with both endpoints that it is ok to detach. but 
						// for this we'll have to get a bit fancier: right now if you use the same beforeDetach
						// interceptor for two endpoints (which is kind of common, because it's part of the
						// endpoint definition), then it gets fired twice.  so in fact we need to loop through
						// each beforeDetach and see if it returns false, at which point we exit.  but if it
						// returns true, we have to check the next one.  however we need to track which ones
						// have already been run, and not run them again.
						if (forceDetach || connection._forceDetach || (self.isDetachAllowed(connection) /*&& t.isDetachAllowed(connection)*/)) {
					
							self.connections.splice(idx, 1);										
					
							// this avoids a circular loop
							if (!ignoreTarget) {
							
								t.detach(connection, true, forceDetach);
								// check connection to see if we want to delete the endpoints associated with it.
								// we only detach those that have just this connection; this scenario is most
								// likely if we got to this bit of code because it is set by the methods that
								// create their own endpoints, like .connect or .makeTarget. the user is
								// not likely to have interacted with those endpoints.
								if (connection.endpointsToDeleteOnDetach){
									for (var i = 0; i < connection.endpointsToDeleteOnDetach.length; i++) {
										var cde = connection.endpointsToDeleteOnDetach[i];
										if (cde && cde.connections.length == 0) 
											_currentInstance.deleteEndpoint(cde);							
									}
								}
							}
							_removeElements(connection.connector.getDisplayElements(), connection.parent);
							_removeWithFunction(connectionsByScope[connection.scope], function(c) {
								return c.id == connection.id;
							});
							actuallyDetached = true;
                            var doFireEvent = (!ignoreTarget && fireEvent)
							fireDetachEvent(connection, doFireEvent, originalEvent);
						}
					}
				}
				return actuallyDetached;
			};			

			/*
			 * Function: detachAll
			 *   Detaches all Connections this Endpoint has.
			 *
			 * Parameters:
			 *  fireEvent   -   whether or not to fire the detach event.  defaults to false.
			 */
			this.detachAll = function(fireEvent, originalEvent) {
				while (self.connections.length > 0) {
					self.detach(self.connections[0], false, true, fireEvent, originalEvent);
				}
			};
			/*
			 * Function: detachFrom
			 *   Removes any connections from this Endpoint that are connected to the given target endpoint.
			 *   
			 * Parameters:
			 *   targetEndpoint     - Endpoint from which to detach all Connections from this Endpoint.
			 *   fireEvent          - whether or not to fire the detach event. defaults to false.
			 */
			this.detachFrom = function(targetEndpoint, fireEvent, originalEvent) {
				var c = [];
				for ( var i = 0; i < self.connections.length; i++) {
					if (self.connections[i].endpoints[1] == targetEndpoint
							|| self.connections[i].endpoints[0] == targetEndpoint) {
						c.push(self.connections[i]);
					}
				}
				for ( var i = 0; i < c.length; i++) {
					if (self.detach(c[i], false, true, fireEvent, originalEvent))
						c[i].setHover(false, false);					
				}
			};			
			/*
			 * Function: detachFromConnection
			 *   Detach this Endpoint from the Connection, but leave the Connection alive. Used when dragging.
			 *   
			 * Parameters:
			 *   connection - Connection to detach from.
			 */
			this.detachFromConnection = function(connection) {
				var idx =  _findWithFunction(self.connections, function(c) { return c.id == connection.id});
				if (idx >= 0) {
					self.connections.splice(idx, 1);
				}
			};

			/*
			 * Function: getElement
			 *   Returns the DOM element this Endpoint is attached to.
			 */
			this.getElement = function() {
				return _element;
			};		
			
			/*
			 * Function: setElement
			 * Sets the DOM element this Endpoint is attached to.  
			 */
			this.setElement = function(el, container) {

				// TODO possibly have this object take charge of moving the UI components into the appropriate
				// parent.  this is used only by makeSource right now, and that function takes care of
				// moving the UI bits and pieces.  however it would s			
				var parentId = _getId(el);
				// remove the endpoint from the list for the current endpoint's element
				_removeWithFunction(endpointsByElement[self.elementId], function(e) {
					return e.id == self.id;
				});
				_element = _getElementObject(el);
				_elementId = _getId(_element);
				self.elementId = _elementId;
				// need to get the new parent now
				var newParentElement = _getParentFromParams({source:parentId, container:container}),
				curParent = jpcl.getParent(self.canvas);
				jpcl.removeElement(self.canvas, curParent);
				jpcl.appendElement(self.canvas, newParentElement);								
				
				// now move connection(s)...i would expect there to be only one but we will iterate.
				for (var i = 0; i < self.connections.length; i++) {
					self.connections[i].moveParent(newParentElement);
					self.connections[i].sourceId = _elementId;
					self.connections[i].source = _element;					
				}	
				_addToList(endpointsByElement, parentId, self);
				//_currentInstance.repaint(parentId);			
			
			};

			/*
			 * Function: getUuid
			 *   Returns the UUID for this Endpoint, if there is one. Otherwise returns null.
			 */
			this.getUuid = function() {
				return _uuid;
			};
			/**
			 * private but must be exposed.
			 */
			this.makeInPlaceCopy = function() {
				var loc = self.anchor.getCurrentLocation(self),
					o = self.anchor.getOrientation(self),
					inPlaceAnchor = {
						compute:function() { return [ loc[0], loc[1] ]},
						getCurrentLocation : function() { return [ loc[0], loc[1] ]},
						getOrientation:function() { return o; }
					};

				return _newEndpoint( { 
					anchor : inPlaceAnchor, 
					source : _element, 
					paintStyle : this.getPaintStyle(), 
					endpoint : _endpoint,
					_transient:true,
                    scope:self.scope
				});
			};
			/*
			 * Function: isConnectedTo
			 *   Returns whether or not this endpoint is connected to the given Endpoint.
			 *   
			 * Parameters:
			 *   endpoint - Endpoint to test.
			 */
			this.isConnectedTo = function(endpoint) {
				var found = false;
				if (endpoint) {
					for ( var i = 0; i < self.connections.length; i++) {
						if (self.connections[i].endpoints[1] == endpoint) {
							found = true;
							break;
						}
					}
				}
				return found;
			};

			/**
			 * private but needs to be exposed.
			 */
			this.isFloating = function() {
				return floatingEndpoint != null;
			};
			
			/**
			 * returns a connection from the pool; used when dragging starts.  just gets the head of the array if it can.
			 */
			this.connectorSelector = function() {
				var candidate = self.connections[0];
				if (self.isTarget && candidate) return candidate;
				else {
					return (self.connections.length < _maxConnections) || _maxConnections == -1 ? null : candidate;
				}
			};

			/*
			 * Function: isFull
			 *   Returns whether or not the Endpoint can accept any more Connections.
			 */
			this.isFull = function() {
				return !(self.isFloating() || _maxConnections < 1 || self.connections.length < _maxConnections);				
			};
			/*
			 * Function: setDragAllowedWhenFull
			 *   Sets whether or not connections can be dragged from this Endpoint once it is full. You would use this in a UI in 
			 *   which you're going to provide some other way of breaking connections, if you need to break them at all. This property 
			 *   is by default true; use it in conjunction with the 'reattach' option on a connect call.
			 *   
			 * Parameters:
			 *   allowed - whether drag is allowed or not when the Endpoint is full.
			 */
			this.setDragAllowedWhenFull = function(allowed) {
				dragAllowedWhenFull = allowed;
			};
			/*
			 * Function: setStyle
			 *   Sets the paint style of the Endpoint.  This is a JS object of the same form you supply to a jsPlumb.addEndpoint or jsPlumb.connect call.
			 *   TODO move setStyle into EventGenerator, remove it from here. is Connection's method currently setPaintStyle ? wire that one up to
			 *   setStyle and deprecate it if so.
			 *   
			 * Parameters:
			 *   style - Style object to set, for example {fillStyle:"blue"}.
			 *   
			 *  @deprecated use setPaintStyle instead.
			 */
			this.setStyle = self.setPaintStyle;

			/**
			 * a deep equals check. everything must match, including the anchor,
			 * styles, everything. TODO: finish Endpoint.equals
			 */
			this.equals = function(endpoint) {
				return this.anchor.equals(endpoint.anchor);
			};
			
			// a helper function that tries to find a connection to the given element, and returns it if so. if elementWithPrecedence is null,
			// or no connection to it is found, we return the first connection in our list.
			var findConnectionToUseForDynamicAnchor = function(elementWithPrecedence) {
				var idx = 0;
				if (elementWithPrecedence != null) {
					for (var i = 0; i < self.connections.length; i++) {
						if (self.connections[i].sourceId == elementWithPrecedence || self.connections[i].targetId == elementWithPrecedence) {
							idx = i;
							break;
						}
					}
				}
				
				return self.connections[idx];
			};

			/*
			 * Function: paint
			 *   Paints the Endpoint, recalculating offset and anchor positions if necessary. This does NOT paint
			 *   any of the Endpoint's connections.
			 *   
			 * Parameters:
			 *   timestamp - optional timestamp advising the Endpoint of the current paint time; if it has painted already once for this timestamp, it will not paint again.
			 *   canvas - optional Canvas to paint on.  Only used internally by jsPlumb in certain obscure situations.
			 *   connectorPaintStyle - paint style of the Connector attached to this Endpoint. Used to get a fillStyle if nothing else was supplied.
			 */
			this.paint = function(params) {
				params = params || {};
				var timestamp = params.timestamp, recalc = !(params.recalc === false);
								//recalc = params.recalc;
				if (!timestamp || self.timestamp !== timestamp) {						
					_updateOffset({ elId:_elementId, timestamp:timestamp, recalc:recalc });
					var xy = params.offset || offsets[_elementId];
					if(xy) {
						var ap = params.anchorPoint,connectorPaintStyle = params.connectorPaintStyle;
						if (ap == null) {
							var wh = params.dimensions || sizes[_elementId];
							if (xy == null || wh == null) {
								_updateOffset( { elId : _elementId, timestamp : timestamp });
								xy = offsets[_elementId];
								wh = sizes[_elementId];
							}
							var anchorParams = { xy : [ xy.left, xy.top ], wh : wh, element : self, timestamp : timestamp };
							if (recalc && self.anchor.isDynamic && self.connections.length > 0) {
								var c = findConnectionToUseForDynamicAnchor(params.elementWithPrecedence),
								oIdx = c.endpoints[0] == self ? 1 : 0,
								oId = oIdx == 0 ? c.sourceId : c.targetId,
								oOffset = offsets[oId], oWH = sizes[oId];
								anchorParams.txy = [ oOffset.left, oOffset.top ];
								anchorParams.twh = oWH;
								anchorParams.tElement = c.endpoints[oIdx];
							}
							ap = self.anchor.compute(anchorParams);
						}
											
						// switched _endpoint to self here; continuous anchors, for instance, look for the
						// endpoint's id, but here "_endpoint" is the renderer, not the actual endpoint.
						// TODO need to verify this does not break anything.
						//var d = _endpoint.compute(ap, self.anchor.getOrientation(_endpoint), self.paintStyleInUse, connectorPaintStyle || self.paintStyleInUse);
						var d = _endpoint.compute(ap, self.anchor.getOrientation(self), self.paintStyleInUse, connectorPaintStyle || self.paintStyleInUse);
						_endpoint.paint(d, self.paintStyleInUse, self.anchor);					
						self.timestamp = timestamp;

						/* paint overlays*/
						for ( var i = 0; i < self.overlays.length; i++) {
							var o = self.overlays[i];
							if (o.isVisible) self.overlayPlacements[i] = o.draw(self.endpoint, self.paintStyleInUse, d);
						}
					}
				}
			};

            this.repaint = this.paint;

			/**
			 * @deprecated
			 */
			this.removeConnection = this.detach; // backwards compatibility

			// is this a connection source? we make it draggable and have the
			// drag listener maintain a connection with a floating endpoint.
			if (jsPlumb.CurrentLibrary.isDragSupported(_element)) {
				var placeholderInfo = { id:null, element:null },
                    jpc = null,
                    existingJpc = false,
                    existingJpcParams = null,
                    _dragHandler = _makeConnectionDragHandler(placeholderInfo);

				var start = function() {	
				// drag might have started on an endpoint that is not actually a source, but which has
				// one or more connections.
					jpc = self.connectorSelector();
                    var _continue = true;
                    // if not enabled, return
                    if (!self.isEnabled()) _continue = false;
					// if no connection and we're not a source, return.
					if (jpc == null && !params.isSource) _continue = false;
                    // otherwise if we're full and not allowed to drag, also return false.
                    if (params.isSource && self.isFull() && !dragAllowedWhenFull) _continue = false;
                    // if the connection was setup as not detachable or one of its endpoints
                    // was setup as connectionsDetachable = false, or Defaults.ConnectionsDetachable
                    // is set to false...
                    if (jpc != null && !jpc.isDetachable()) _continue = false;

                    if (_continue === false) {
                        // this is for mootools and yui. returning false from this causes jquery to stop drag.
                        // the events are wrapped in both mootools and yui anyway, but i don't think returning
                        // false from the start callback would stop a drag.
                        if (jsPlumb.CurrentLibrary.stopDrag) jsPlumb.CurrentLibrary.stopDrag();
                        _dragHandler.stopDrag();
                        return false;
                    }

					// if we're not full but there was a connection, make it null. we'll create a new one.
					if (jpc && !self.isFull() && params.isSource) jpc = null;

					_updateOffset( { elId : _elementId });
					inPlaceCopy = self.makeInPlaceCopy();
					inPlaceCopy.referenceEndpoint = self;
					inPlaceCopy.paint();																
					
					_makeDraggablePlaceholder(placeholderInfo, self.parent);
					
					// set the offset of this div to be where 'inPlaceCopy' is, to start with.
					// TODO merge this code with the code in both Anchor and FloatingAnchor, because it
					// does the same stuff.
					var ipcoel = _getElementObject(inPlaceCopy.canvas),
					    ipco = _getOffset(ipcoel, _currentInstance),
					    po = adjustForParentOffsetAndScroll([ipco.left, ipco.top], inPlaceCopy.canvas);
					jsPlumb.CurrentLibrary.setOffset(placeholderInfo.element, {left:po[0], top:po[1]});															
					
					// when using makeSource and a parent, we first draw the source anchor on the source element, then
					// move it to the parent.  note that this happens after drawing the placeholder for the
					// first time.
					if (self.parentAnchor) self.anchor = _currentInstance.makeAnchor(self.parentAnchor, self.elementId, _currentInstance);

					// store the id of the dragging div and the source element. the drop function will pick these up.					
					_setAttribute(_getElementObject(self.canvas), "dragId", placeholderInfo.id);
					_setAttribute(_getElementObject(self.canvas), "elId", _elementId);

					// create a floating endpoint.
					// here we test to see if a dragProxy was specified in this endpoint's constructor params, and
					// if so, we create that endpoint instead of cloning ourselves.
					if (params.proxy) {
				/*		var floatingAnchor = new FloatingAnchor( { reference : self.anchor, referenceCanvas : self.canvas });

						floatingEndpoint = _newEndpoint({ 
							paintStyle : params.proxy.paintStyle,
							endpoint : params.proxy.endpoint,
							anchor : floatingAnchor, 
							source : placeholderInfo.element, 
							scope:"__floating" 
						});		
						
						//$(self.canvas).hide();									
						*/
						self.setPaintStyle(params.proxy.paintStyle);
						// if we do this, we have to cleanup the old one. like just remove its display parts												
						//self.setEndpoint(params.proxy.endpoint);

					}
				//	else {
						floatingEndpoint = _makeFloatingEndpoint(self.getPaintStyle(), self.anchor, _endpoint, self.canvas, placeholderInfo.element);
				//	}
					
					if (jpc == null) {                                                                                                                                                         
						self.anchor.locked = true;
                        self.setHover(false, false);
                        // TODO the hover call above does not reset any target endpoint's hover
                        // states.
						// create a connection. one end is this endpoint, the other is a floating endpoint.
						jpc = _newConnection({
							sourceEndpoint : self,
							targetEndpoint : floatingEndpoint,
							source : self.endpointWillMoveTo || _getElementObject(_element),  // for makeSource with parent option.  ensure source element is represented correctly.
							target : placeholderInfo.element,
							anchors : [ self.anchor, floatingEndpoint.anchor ],
							paintStyle : params.connectorStyle, // this can be null. Connection will use the default.
							hoverPaintStyle:params.connectorHoverStyle,
							connector : params.connector, // this can also be null. Connection will use the default.
							overlays : params.connectorOverlays,
							type:self.connectionType,
							cssClass:self.connectorClass,
							hoverClass:self.connectorHoverClass
						});

					} else {
						existingJpc = true;
						jpc.connector.setHover(false, false);
						// if existing connection, allow to be dropped back on the source endpoint (issue 51).
						_initDropTarget(_getElementObject(inPlaceCopy.canvas), false, true);
						// new anchor idx
						var anchorIdx = jpc.endpoints[0].id == self.id ? 0 : 1;
						jpc.floatingAnchorIndex = anchorIdx;					// save our anchor index as the connection's floating index.						
						self.detachFromConnection(jpc);							// detach from the connection while dragging is occurring.
						
						// store the original scope (issue 57)
						var c = _getElementObject(self.canvas),
						    dragScope = jsPlumb.CurrentLibrary.getDragScope(c);
						_setAttribute(c, "originalScope", dragScope);
						// now we want to get this endpoint's DROP scope, and set it for now: we can only be dropped on drop zones
						// that have our drop scope (issue 57).
						var dropScope = jsPlumb.CurrentLibrary.getDropScope(c);
						jsPlumb.CurrentLibrary.setDragScope(c, dropScope);
				
						// now we replace ourselves with the temporary div we created above:
						if (anchorIdx == 0) {
							existingJpcParams = [ jpc.source, jpc.sourceId, i, dragScope ];
							jpc.source = placeholderInfo.element;
							jpc.sourceId = placeholderInfo.id;
						} else {
							existingJpcParams = [ jpc.target, jpc.targetId, i, dragScope ];
							jpc.target = placeholderInfo.element;
							jpc.targetId = placeholderInfo.id;
						}

						// lock the other endpoint; if it is dynamic it will not move while the drag is occurring.
						jpc.endpoints[anchorIdx == 0 ? 1 : 0].anchor.locked = true;
						// store the original endpoint and assign the new floating endpoint for the drag.
						jpc.suspendedEndpoint = jpc.endpoints[anchorIdx];
						jpc.suspendedEndpoint.setHover(false);
						floatingEndpoint.referenceEndpoint = jpc.suspendedEndpoint;
						jpc.endpoints[anchorIdx] = floatingEndpoint;

						// fire an event that informs that a connection is being dragged
						fireConnectionDraggingEvent(jpc);

					}
					// register it and register connection on it.
					floatingConnections[placeholderInfo.id] = jpc;
					floatingEndpoint.addConnection(jpc);
					// only register for the target endpoint; we will not be dragging the source at any time
					// before this connection is either discarded or made into a permanent connection.
					_addToList(endpointsByElement, placeholderInfo.id, floatingEndpoint);
					// tell jsplumb about it
					_currentInstance.currentlyDragging = true;
				};

				var jpcl = jsPlumb.CurrentLibrary,
				    dragOptions = params.dragOptions || {},
				    defaultOpts = jsPlumb.extend( {}, jpcl.defaultDragOptions),
				    startEvent = jpcl.dragEvents["start"],
				    stopEvent = jpcl.dragEvents["stop"],
				    dragEvent = jpcl.dragEvents["drag"];
				
				dragOptions = jsPlumb.extend(defaultOpts, dragOptions);
				dragOptions.scope = dragOptions.scope || self.scope;
				dragOptions[startEvent] = _wrap(dragOptions[startEvent], start);
				// extracted drag handler function so can be used by makeSource
				dragOptions[dragEvent] = _wrap(dragOptions[dragEvent], _dragHandler.drag);
				dragOptions[stopEvent] = _wrap(dragOptions[stopEvent],
					function() {
						var originalEvent = jpcl.getDropEvent(arguments);
						_currentInstance.currentlyDragging = false;						
						_removeWithFunction(endpointsByElement[placeholderInfo.id], function(e) {
							return e.id == floatingEndpoint.id;
						});
						_removeElements( [ placeholderInfo.element[0], floatingEndpoint.canvas ], _element); // TODO: clean up the connection canvas (if the user aborted)
						_removeElement(inPlaceCopy.canvas, _element);
						_currentInstance.anchorManager.clearFor(placeholderInfo.id);						
						var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex;
						jpc.endpoints[idx == 0 ? 1 : 0].anchor.locked = false;
						self.setPaintStyle(originalPaintStyle); // reset to original; may have been changed by drag proxy.
						if (jpc.endpoints[idx] == floatingEndpoint) {
							// if the connection was an existing one:
							if (existingJpc && jpc.suspendedEndpoint) {
								// fix for issue35, thanks Sylvain Gizard: when firing the detach event make sure the
								// floating endpoint has been replaced.
								if (idx == 0) {
									jpc.source = existingJpcParams[0];
									jpc.sourceId = existingJpcParams[1];
								} else {
									jpc.target = existingJpcParams[0];
									jpc.targetId = existingJpcParams[1];
								}
								
								// restore the original scope (issue 57)
								jsPlumb.CurrentLibrary.setDragScope(existingJpcParams[2], existingJpcParams[3]);
								jpc.endpoints[idx] = jpc.suspendedEndpoint;
								//if (self.isReattach || jpc._forceDetach || !jpc.endpoints[idx == 0 ? 1 : 0].detach(jpc, false, false, true, originalEvent)) {
								if (jpc.isReattach() || jpc._forceReattach || jpc._forceDetach || !jpc.endpoints[idx == 0 ? 1 : 0].detach(jpc, false, false, true, originalEvent)) {									
									jpc.setHover(false);
									jpc.floatingAnchorIndex = null;
									jpc.suspendedEndpoint.addConnection(jpc);
									_currentInstance.repaint(existingJpcParams[1]);
								}
                                jpc._forceDetach = null;
								jpc._forceReattach = null;
							} else {
								// TODO this looks suspiciously kind of like an Endpoint.detach call too.
								// i wonder if this one should post an event though.  maybe this is good like this.
								_removeElements(jpc.connector.getDisplayElements(), self.parent);
								self.detachFromConnection(jpc);								
							}																
						}
						self.anchor.locked = false;												
						self.paint({recalc:false});
						jpc.setHover(false, false);

						fireConnectionDragStopEvent(jpc);

						jpc = null;						
						inPlaceCopy = null;							
						delete endpointsByElement[floatingEndpoint.elementId];
						floatingEndpoint.anchor = null;
                        floatingEndpoint = null;
						_currentInstance.currentlyDragging = false;


					});
				
				var i = _getElementObject(self.canvas);				
				jsPlumb.CurrentLibrary.initDraggable(i, dragOptions, true);
			}

			// pulled this out into a function so we can reuse it for the inPlaceCopy canvas; you can now drop detached connections
			// back onto the endpoint you detached it from.
			var _initDropTarget = function(canvas, forceInit, isTransient, endpoint) {
				if ((params.isTarget || forceInit) && jsPlumb.CurrentLibrary.isDropSupported(_element)) {
					var dropOptions = params.dropOptions || _currentInstance.Defaults.DropOptions || jsPlumb.Defaults.DropOptions;
					dropOptions = jsPlumb.extend( {}, dropOptions);
					dropOptions.scope = dropOptions.scope || self.scope;
					var dropEvent = jsPlumb.CurrentLibrary.dragEvents['drop'],
					    overEvent = jsPlumb.CurrentLibrary.dragEvents['over'],
					    outEvent = jsPlumb.CurrentLibrary.dragEvents['out'],
						drop = function() {
														
							var originalEvent = jsPlumb.CurrentLibrary.getDropEvent(arguments),
								draggable = _getElementObject(jsPlumb.CurrentLibrary.getDragObject(arguments)),
								id = _getAttribute(draggable, "dragId"),
								elId = _getAttribute(draggable, "elId"),						
								scope = _getAttribute(draggable, "originalScope"),
								jpc = floatingConnections[id];
								
							// if this is a drop back where the connection came from, mark it force rettach and
							// return; the stop handler will reattach. without firing an event.
							var redrop = jpc.suspendedEndpoint && (jpc.suspendedEndpoint.id == self.id ||
											self.referenceEndpoint && jpc.suspendedEndpoint.id == self.referenceEndpoint.id) ;							
							if (redrop) {								
								jpc._forceReattach = true;
								return;
							}

							if (jpc != null) {
								var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex, oidx = idx == 0 ? 1 : 0;
								
								// restore the original scope if necessary (issue 57)						
								if (scope) jsPlumb.CurrentLibrary.setDragScope(draggable, scope);							
								
								var endpointEnabled = endpoint != null ? endpoint.isEnabled() : true;
								
								if (self.isFull()) {
									self.fire("maxConnections", { 
										endpoint:self, 
										connection:jpc, 
										maxConnections:_maxConnections 
									}, originalEvent);
								}
																
								if (!self.isFull() && !(idx == 0 && !self.isSource) && !(idx == 1 && !self.isTarget) && endpointEnabled) {
									var _doContinue = true;
	
									// the second check here is for the case that the user is dropping it back
									// where it came from.
									if (jpc.suspendedEndpoint && jpc.suspendedEndpoint.id != self.id) {
										if (idx == 0) {
											jpc.source = jpc.suspendedEndpoint.element;
											jpc.sourceId = jpc.suspendedEndpoint.elementId;
										} else {
											jpc.target = jpc.suspendedEndpoint.element;
											jpc.targetId = jpc.suspendedEndpoint.elementId;
										}
	
										if (!jpc.isDetachAllowed(jpc) || !jpc.endpoints[idx].isDetachAllowed(jpc) || !jpc.suspendedEndpoint.isDetachAllowed(jpc) || !_currentInstance.checkCondition("beforeDetach", jpc))
											_doContinue = false;								
									}
				
									// these have to be set before testing for beforeDrop.
									if (idx == 0) {
										jpc.source = self.element;
										jpc.sourceId = self.elementId;
									} else {
										jpc.target = self.element;
										jpc.targetId = self.elementId;
									}
																
									// now check beforeDrop.  this will be available only on Endpoints that are setup to
									// have a beforeDrop condition (although, secretly, under the hood all Endpoints and 
									// the Connection have them, because they are on jsPlumbUIComponent.  shhh!), because
									// it only makes sense to have it on a target endpoint.
									_doContinue = _doContinue && self.isDropAllowed(jpc.sourceId, jpc.targetId, jpc.scope, jpc, self);
															
									if (_doContinue) {
										// remove this jpc from the current endpoint
										jpc.endpoints[idx].detachFromConnection(jpc);
										if (jpc.suspendedEndpoint) jpc.suspendedEndpoint.detachFromConnection(jpc);
										jpc.endpoints[idx] = self;
										self.addConnection(jpc);
										
										// copy our parameters in to the connection:
										var params = self.getParameters();
										for (var aParam in params)
											jpc.setParameter(aParam, params[aParam]);
	
										if (!jpc.suspendedEndpoint) {  
											if (params.draggable)
												jsPlumb.CurrentLibrary.initDraggable(self.element, dragOptions, true);
										}
										else {
											var suspendedElement = jpc.suspendedEndpoint.getElement(), suspendedElementId = jpc.suspendedEndpoint.elementId;
											// fire a detach event
											fireDetachEvent({
												source : idx == 0 ? suspendedElement : jpc.source, 
												target : idx == 1 ? suspendedElement : jpc.target,
												sourceId : idx == 0 ? suspendedElementId : jpc.sourceId, 
												targetId : idx == 1 ? suspendedElementId : jpc.targetId,
												sourceEndpoint : idx == 0 ? jpc.suspendedEndpoint : jpc.endpoints[0], 
												targetEndpoint : idx == 1 ? jpc.suspendedEndpoint : jpc.endpoints[1],
												connection : jpc
											}, true, originalEvent);
										}
	
										// finalise will inform the anchor manager and also add to
										// connectionsByScope if necessary.
										_finaliseConnection(jpc, null, originalEvent);
									}
									else {
										// otherwise just put it back on the endpoint it was on before the drag.
										if (jpc.suspendedEndpoint) {									
											jpc.endpoints[idx] = jpc.suspendedEndpoint;
											jpc.setHover(false);
											jpc._forceDetach = true;
											if (idx == 0) {
												jpc.source = jpc.suspendedEndpoint.element;
												jpc.sourceId = jpc.suspendedEndpoint.elementId;
											} else {
												jpc.target = jpc.suspendedEndpoint.element;
												jpc.targetId = jpc.suspendedEndpoint.elementId;;
											}
											jpc.suspendedEndpoint.addConnection(jpc);
	
											jpc.endpoints[0].repaint();
											jpc.repaint();
											_currentInstance.repaint(jpc.source.elementId);
											jpc._forceDetach = false;
										}
									}
	
									jpc.floatingAnchorIndex = null;
								}
								_currentInstance.currentlyDragging = false;
								delete floatingConnections[id];
								jpc.suspendedEndpoint = null;
							}
						};
					
					dropOptions[dropEvent] = _wrap(dropOptions[dropEvent], drop);
					dropOptions[overEvent] = _wrap(dropOptions[overEvent], function() {					
						var draggable = jsPlumb.CurrentLibrary.getDragObject(arguments),
							id = _getAttribute( _getElementObject(draggable), "dragId"),
							_jpc = floatingConnections[id];
							
						if (_jpc != null) {								
							var idx = _jpc.floatingAnchorIndex == null ? 1 : _jpc.floatingAnchorIndex;
							// here we should fire the 'over' event if we are a target and this is a new connection,
							// or we are the same as the floating endpoint.								
							var _cont = (self.isTarget && _jpc.floatingAnchorIndex != 0) || (_jpc.suspendedEndpoint && self.referenceEndpoint && self.referenceEndpoint.id == _jpc.suspendedEndpoint.id);
							if (_cont)
								_jpc.endpoints[idx].anchor.over(self.anchor);
						}						
					});	
					dropOptions[outEvent] = _wrap(dropOptions[outEvent], function() {					
						var draggable = jsPlumb.CurrentLibrary.getDragObject(arguments),
							id = _getAttribute( _getElementObject(draggable), "dragId"),
							_jpc = floatingConnections[id];
							
						if (_jpc != null) {
							var idx = _jpc.floatingAnchorIndex == null ? 1 : _jpc.floatingAnchorIndex;
							var _cont = (self.isTarget && _jpc.floatingAnchorIndex != 0) || (_jpc.suspendedEndpoint && self.referenceEndpoint && self.referenceEndpoint.id == _jpc.suspendedEndpoint.id);
							if (_cont)
								_jpc.endpoints[idx].anchor.out();
						}
					});
					jsPlumb.CurrentLibrary.initDroppable(canvas, dropOptions, true, isTransient);
				}
			};
			
			// initialise the endpoint's canvas as a drop target.  this will be ignored if the endpoint is not a target or drag is not supported.
			_initDropTarget(_getElementObject(self.canvas), true, !(params._transient || self.anchor.isFloating), self);
			
			 // finally, set type if it was provided
			 if (params.type)
				self.addType(params.type);

// ***************************** PLACEHOLDERS FOR NATURAL DOCS *************************************************
			/*
			 * Function: bind
			 * Bind to an event on the Endpoint.  
			 * 
			 * Parameters:
			 * 	event - the event to bind.  Available events on an Endpoint are:
			 *         - *click*						:	notification that a Endpoint was clicked.  
			 *         - *dblclick*						:	notification that a Endpoint was double clicked.
			 *         - *mouseenter*					:	notification that the mouse is over a Endpoint. 
			 *         - *mouseexit*					:	notification that the mouse exited a Endpoint.
			 * 		   - *contextmenu*                  :   notification that the user right-clicked on the Endpoint.
			 *         
			 *  callback - function to callback. This function will be passed the Endpoint that caused the event, and also the original event.    
			 */
			
			/*
		     * Function: setPaintStyle
		     * Sets the Endpoint's paint style and then repaints the Endpoint.
		     * 
		     * Parameters:
		     * 	style - Style to use.
		     */

		     /*
		     * Function: getPaintStyle
		     * Gets the Endpoint's paint style. This is not necessarily the paint style in use at the time;
		     * this is the paint style for the Endpoint when the mouse it not hovering over it.
		     */
			
			/*
		     * Function: setHoverPaintStyle
		     * Sets the paint style to use when the mouse is hovering over the Endpoint. This is null by default.
		     * The hover paint style is applied as extensions to the paintStyle; it does not entirely replace
		     * it.  This is because people will most likely want to change just one thing when hovering, say the
		     * color for example, but leave the rest of the appearance the same.
		     * 
		     * Parameters:
		     * 	style - Style to use when the mouse is hovering.
		     *  doNotRepaint - if true, the Endpoint will not be repainted.  useful when setting things up initially.
		     */
			
			/*
		     * Function: setHover
		     * Sets/unsets the hover state of this Endpoint.
		     * 
		     * Parameters:
		     * 	hover - hover state boolean
		     * 	ignoreAttachedElements - if true, does not notify any attached elements of the change in hover state.  used mostly to avoid infinite loops.
		     */

		     /*
		     * Function: getParameter
		     * Gets the named parameter; returns null if no parameter with that name is set. Parameters may have been set on the Endpoint in the 'addEndpoint' call, or they may have been set with the setParameter function.
		     *
		     * Parameters:
		     *   key - Parameter name.
		     */

		     /*
		     * Function: setParameter
		     * Sets the named parameter to the given value.
		     *
		     * Parameters:
		     *   key - Parameter name.
		     *   value - Parameter value.
		     */
			 
			 /*
			 * Property: canvas
			 * The Endpoint's drawing area.
			 */
			/*
			 * Property: connections
			 * List of Connections this Endpoint is attached to.
			 */
			/*
			 * Property: scope
			 * Scope descriptor for this Endpoint.
			 */
			
			/*
			 * Property: overlays
			 * List of Overlays for this Endpoint.
			 */
			/*
			 * Function: addOverlay
			 * Adds an Overlay to the Endpoint.
			 * 
			 * Parameters:
			 * 	overlay - Overlay to add.
			 */
			/*
			 * Function: getOverlay
			 * Gets an overlay, by ID. Note: by ID.  You would pass an 'id' parameter
			 * in to the Overlay's constructor arguments, and then use that to retrieve
			 * it via this method.
			 */
			/*
			* Function: getOverlays
			* Gets all the overlays for this component.
			*/
			/*
			 * Function: hideOverlay
			 * Hides the overlay specified by the given id.
			 */
			/*
			 * Function: hideOverlays
			 * Hides all Overlays
			 */
			/*
			 * Function: showOverlay
			 * Shows the overlay specified by the given id.
			 */
			/*
			 * Function: showOverlays
			 * Shows all Overlays 
			 */
			/**
			 * Function: removeAllOverlays
			 * Removes all overlays from the Endpoint, and then repaints.
			 */
			/**
			 * Function: removeOverlay
			 * Removes an overlay by ID.  Note: by ID.  this is a string you set in the overlay spec.
			 * Parameters:
			 * overlayId - id of the overlay to remove.
			 */
			/**
			 * Function: removeOverlays
			 * Removes a set of overlays by ID.  Note: by ID.  this is a string you set in the overlay spec.
			 * Parameters:
			 * overlayIds - this function takes an arbitrary number of arguments, each of which is a single overlay id.
			 */
			/*
			 * Function: setLabel
			 * Sets the Endpoint's label.  
			 * 
			 * Parameters:
			 * 	l	- label to set. May be a String, a Function that returns a String, or a params object containing { "label", "labelStyle", "location", "cssClass" }.  Note that this uses innerHTML on the label div, so keep
         * that in mind if you need escaped HTML.
			 */
			/*
				Function: getLabel
				Returns the label text for this Endpoint (or a function if you are labelling with a function).
				This does not return the overlay itself; this is a convenience method which is a pair with
				setLabel; together they allow you to add and access a Label Overlay without having to create the
				Overlay object itself.  For access to the underlying label overlay that jsPlumb has created,
				use getLabelOverlay.
			*/
			/*
				Function: getLabelOverlay
				Returns the underlying internal label overlay, which will exist if you specified a label on
				an addEndpoint call, or have called setLabel at any stage.   
			*/
			
// ***************************** END OF PLACEHOLDERS FOR NATURAL DOCS *************************************************
				
			
			return self;
		};					
	};		

	var jsPlumb = new jsPlumbInstance();
	if (typeof window != 'undefined') window.jsPlumb = jsPlumb;
	jsPlumb.getInstance = function(_defaults) {
		var j = new jsPlumbInstance(_defaults);
		j.init();
		return j;
	};	
	
	var _curryAnchor = function(x, y, ox, oy, type, fnInit) {
		return function(params) {
			params = params || {};
			//var a = jsPlumb.makeAnchor([ x, y, ox, oy, 0, 0 ], params.elementId, params.jsPlumbInstance);
			var a = params.jsPlumbInstance.makeAnchor([ x, y, ox, oy, 0, 0 ], params.elementId, params.jsPlumbInstance);
			a.type = type;
			if (fnInit) fnInit(a, params);
			return a;
		};
	};
	/*
	 * Property: Anchors.TopCenter
	 * An Anchor that is located at the top center of the element.
	 */
	jsPlumb.Anchors["TopCenter"] 		= _curryAnchor(0.5, 0, 0,-1, "TopCenter");
	/*
	 * Property: Anchors.BottomCenter
	 * An Anchor that is located at the bottom center of the element.
	 */
	jsPlumb.Anchors["BottomCenter"] 	= _curryAnchor(0.5, 1, 0, 1, "BottomCenter");
	/*
	 * Property: Anchors.LeftMiddle
	 * An Anchor that is located at the left middle of the element.
	 */
	jsPlumb.Anchors["LeftMiddle"] 		= _curryAnchor(0, 0.5, -1, 0, "LeftMiddle");
	/*
	 * Property: Anchors.RightMiddle
	 * An Anchor that is located at the right middle of the element.
	 */
	jsPlumb.Anchors["RightMiddle"] 		= _curryAnchor(1, 0.5, 1, 0, "RightMiddle");
	/*
	 * Property: Anchors.Center
	 * An Anchor that is located at the center of the element.
	 */
	jsPlumb.Anchors["Center"] 			= _curryAnchor(0.5, 0.5, 0, 0, "Center");
	/*
	 * Property: Anchors.TopRight
	 * An Anchor that is located at the top right corner of the element.
	 */
	jsPlumb.Anchors["TopRight"] 		= _curryAnchor(1, 0, 0,-1, "TopRight");
	/*
	 * Property: Anchors.BottomRight
	 * An Anchor that is located at the bottom right corner of the element.
	 */
	jsPlumb.Anchors["BottomRight"] 		= _curryAnchor(1, 1, 0, 1, "BottomRight");
	/*
	 * Property: Anchors.TopLeft
	 * An Anchor that is located at the top left corner of the element.
	 */
	jsPlumb.Anchors["TopLeft"] 			= _curryAnchor(0, 0, 0, -1, "TopLeft");
	/*
	 * Property: Anchors.BottomLeft
	 * An Anchor that is located at the bototm left corner of the element.
	 */
	jsPlumb.Anchors["BottomLeft"] 		= _curryAnchor(0, 1, 0, 1, "BottomLeft");
			
	jsPlumb.Defaults.DynamicAnchors = function(params) {
		return params.jsPlumbInstance.makeAnchors(["TopCenter", "RightMiddle", "BottomCenter", "LeftMiddle"], params.elementId, params.jsPlumbInstance);
	};
	/*
	 * Property: Anchors.AutoDefault
	 * Default DynamicAnchors - chooses from TopCenter, RightMiddle, BottomCenter, LeftMiddle.
	 */
	jsPlumb.Anchors["AutoDefault"]  = function(params) { 
		var a = params.jsPlumbInstance.makeDynamicAnchor(jsPlumb.Defaults.DynamicAnchors(params));
		a.type = "AutoDefault";
		return a;
	};
	
	/*
	 * Property: Anchors.Assign
	 * An Anchor whose location is assigned at connection time, through an AnchorPositionFinder. Used in conjunction
	 * with the 'makeTarget' function. jsPlumb has two of these - 'Fixed' and 'Grid', and you can also write your own.
	 */
	jsPlumb.Anchors["Assign"] = _curryAnchor(0,0,0,0,"Assign", function(anchor, params) {
		// find what to use as the "position finder". the user may have supplied a String which represents
		// the id of a position finder in jsPlumb.AnchorPositionFinders, or the user may have supplied the
		// position finder as a function.  we find out what to use and then set it on the anchor.
		var pf = params.position || "Fixed";
		anchor.positionFinder = pf.constructor == String ? params.jsPlumbInstance.AnchorPositionFinders[pf] : pf;
		// always set the constructor params; the position finder might need them later (the Grid one does,
		// for example)
		anchor.constructorParams = params;
	});

	// Continuous anchor is just curried through to the 'get' method of the continuous anchor
	// factory.
	/*
	 * Property: Anchors.Continuous
	 * An Anchor that is tracks the other element in the connection, choosing the closest face.
	 */
	jsPlumb.Anchors["Continuous"] = function(params) {
		return params.jsPlumbInstance.continuousAnchorFactory.get(params);
	};

    // these are the default anchor positions finders, which are used by the makeTarget function.  supply
    // a position finder argument to that function allows you to specify where the resulting anchor will
    // be located
	jsPlumb.AnchorPositionFinders = {
		"Fixed": function(dp, ep, es, params) {
			return [ (dp.left - ep.left) / es[0], (dp.top - ep.top) / es[1] ];	
		},
		"Grid":function(dp, ep, es, params) {
			var dx = dp.left - ep.left, dy = dp.top - ep.top,
				gx = es[0] / (params.grid[0]), gy = es[1] / (params.grid[1]),
				mx = Math.floor(dx / gx), my = Math.floor(dy / gy);
			return [ ((mx * gx) + (gx / 2)) / es[0], ((my * gy) + (gy / 2)) / es[1] ];
		}
	};
	
	/*
	 * Property: Anchors.Perimeter
	 * An Anchor that tracks the perimeter of some shape, approximating it with a given number of dynamically
	 * positioned locations.
	 *
	 * Parameters:
	 *
	 * anchorCount  -   optional number of anchors to use to approximate the perimeter. default is 60.
	 * shape        -   required. the name of the shape. valid values are 'rectangle', 'square', 'ellipse', 'circle', 'triangle' and 'diamond'
	 * rotation     -   optional rotation, in degrees, to apply. 
	 */
	jsPlumb.Anchors["Perimeter"] = function(params) {
		params = params || {};
		var anchorCount = params.anchorCount || 60,
			shape = params.shape;
		
		if (!shape) throw new Error("no shape supplied to Perimeter Anchor type");		
		
		var _circle = function() {
                var r = 0.5, step = Math.PI * 2 / anchorCount, current = 0, a = [];
                for (var i = 0; i < anchorCount; i++) {
                    var x = r + (r * Math.sin(current)),
                        y = r + (r * Math.cos(current));                                
                    a.push( [ x, y, 0, 0 ] );
                    current += step;
                }
                return a;	
            },
            _path = function(segments) {
                var anchorsPerFace = anchorCount / segments.length, a = [],
                    _computeFace = function(x1, y1, x2, y2, fractionalLength) {
                        anchorsPerFace = anchorCount * fractionalLength;
                        var dx = (x2 - x1) / anchorsPerFace, dy = (y2 - y1) / anchorsPerFace;
                        for (var i = 0; i < anchorsPerFace; i++) {
                            a.push( [
                                x1 + (dx * i),
                                y1 + (dy * i),
                                0,
                                0
                            ]);
                        }
                    };
								
                for (var i = 0; i < segments.length; i++)
                    _computeFace.apply(null, segments[i]);
														
                return a;					
            },
			_shape = function(faces) {												
                var s = [];
                for (var i = 0; i < faces.length; i++) {
                    s.push([faces[i][0], faces[i][1], faces[i][2], faces[i][3], 1 / faces.length]);
                }
                return _path(s);
			},
			_rectangle = function() {
				return _shape([
					[ 0, 0, 1, 0 ], [ 1, 0, 1, 1 ], [ 1, 1, 0, 1 ], [ 0, 1, 0, 0 ]
				]);		
			};
		
		var _shapes = {
			"circle":_circle,
			"ellipse":_circle,
			"diamond":function() {
				return _shape([
						[ 0.5, 0, 1, 0.5 ], [ 1, 0.5, 0.5, 1 ], [ 0.5, 1, 0, 0.5 ], [ 0, 0.5, 0.5, 0 ]
				]);
			},
			"rectangle":_rectangle,
			"square":_rectangle,
			"triangle":function() {
				return _shape([
						[ 0.5, 0, 1, 1 ], [ 1, 1, 0, 1 ], [ 0, 1, 0.5, 0]
				]);	
			},
			"path":function(params) {
                var points = params.points;
				var p = [], tl = 0;
				for (var i = 0; i < points.length - 1; i++) {
                    var l = Math.sqrt(Math.pow(points[i][2] - points[i][0]) + Math.pow(points[i][3] - points[i][1]));
                    tl += l;
					p.push([points[i][0], points[i][1], points[i+1][0], points[i+1][1], l]);						
				}
                for (var i = 0; i < p.length; i++) {
                    p[i][4] = p[i][4] / tl;
                }
				return _path(p);
			}
		},
        _rotate = function(points, amountInDegrees) {
            var o = [], theta = amountInDegrees / 180 * Math.PI ;
            for (var i = 0; i < points.length; i++) {
                var _x = points[i][0] - 0.5,
                    _y = points[i][1] - 0.5;
                    
                o.push([
                    0.5 + ((_x * Math.cos(theta)) - (_y * Math.sin(theta))),
                    0.5 + ((_x * Math.sin(theta)) + (_y * Math.cos(theta))),
                    points[i][2],
                    points[i][3]
                ]);
            }
            return o;
        };
		
		if (!_shapes[shape]) throw new Error("Shape [" + shape + "] is unknown by Perimeter Anchor type");
		
		var da = _shapes[shape](params);
        if (params.rotation) da = _rotate(da, params.rotation);
        var a = params.jsPlumbInstance.makeDynamicAnchor(da);
		a.type = "Perimeter";
		return a;
	};
})();
