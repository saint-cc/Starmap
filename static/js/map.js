let scene, camera,  renderer, controls;
let userMarker;					// dot object at players(in game) location
let wireframeSphere;			// attached to dot but uses color direction and size to communicate some user data
let bgSphere;					// background sphere
let PlSphere;					// WIP planet lat lon grid

let running = false;			// used for stop / startAnimation()

let scale = 1e-7; 				// set in loadSystem(), avaiable to all 
let inverseScale = 1 / scale;

let selectedSystem = '';
let selectedTheme = 'Default';	// used to recalculate any color based on a style setting(to simulate monochrome green console for instance)

let trackingInterval = null;	// to make sure no extra updateUserPosition() data poller runs 

let firstBody;					// Center and parent body of loaded system, set in one place read in many(needs default load!)
let userPositionData;			// Available user data, set in one place read in many
let poiInfoWindow = document.getElementById('poi-info-window');

const animateCallbacks = [];

// TIME, time in SC is 6x speed, so 1o real minutes is one in game hour
const serverEpoch = new Date("2025-05-10T14:38:00Z"); // Server time at t=0
const universeEpoch = new Date("2025-02-21T15:48:00Z"); // Universe time at t=0
const UNIVERSE_TIME_SCALE = 6; // 6x speed
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function init() {
    // Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 1, 1e7);
	camera.position.set(30, -67, 100); 
	camera.up.set(0, 0, 1);           // Set OrbitControls' up vector
    // Renderer
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
	
	lblcanvas = initLabelCanvas(renderer);

    // Controlsaw
	controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.05;
	controls.minDistance = 1;
	controls.maxDistance = 3000;

    window.addEventListener("resize", onWindowResize, false);
	window.addEventListener("orientationchange", onWindowResize, false);
	document.addEventListener("fullscreenchange", onWindowResize, false);
	
	if (!poiInfoWindow) {
		poiInfoWindow = document.createElement('div');
		poiInfoWindow.id = 'poi-info-window';
		poiInfoWindow.style.position = 'fixed';
		poiInfoWindow.style.left = '15%';
		poiInfoWindow.style.top = '50%';
		poiInfoWindow.style.transform = 'translateY(-50%)';
		poiInfoWindow.style.background = 'rgba(0,0,0,0.7)';
		poiInfoWindow.style.color = '#fff';
		poiInfoWindow.style.padding = '12px';
		poiInfoWindow.style.fontSize = '12px';
		poiInfoWindow.style.borderRadius = '8px';
		poiInfoWindow.style.maxWidth = '400px';
		poiInfoWindow.style.pointerEvents = 'auto';
		poiInfoWindow.style.display = 'none';
		poiInfoWindow.style.zIndex = '200';
		poiInfoWindow.style.overflow = 'auto';
		document.body.appendChild(poiInfoWindow);

		// --- Close button ---
		const closeBtn = document.createElement('div');
		closeBtn.innerText = '[close]';
		closeBtn.style.position = 'absolute';
		closeBtn.style.top = '4px';
		closeBtn.style.right = '4px';
		closeBtn.style.cursor = 'pointer';
		closeBtn.style.fontWeight = 'bold';
		closeBtn.style.color = '#fff';
		closeBtn.style.zIndex = '999';
		closeBtn.addEventListener('click', () => {
			poiInfoWindow.style.display = 'none';
		});
		poiInfoWindow.appendChild(closeBtn);

		// --- Content container ---
		const contentDiv = document.createElement('div');
		contentDiv.id = 'poi-info-content';
		contentDiv.style.marginTop = '20px'; // leave space for close button
		poiInfoWindow.appendChild(contentDiv);
	}

}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function themeHelper() {
  // convert filtered color to css hex
  const color = "#" + filterColorByTheme(0xffffff, selectedTheme)
    .toString(16)
    .padStart(6, "0");

  // list of element ids
  const ids = [
    "goBCK",
    "goFS",
    "overlayDisplay",
    "systemSelect",
    "ThemeSelect",
    "topInfo",

	"togglePanel1",
	"togglePanel2",
    "groupPanel",
	"settingsPanel",
	
	"toggleLog1",
	"toggleLog2",
	"retroConsole",
	"statusConsole",
	"poi-info-window"
	
  ];

  // apply color to each element if it exists
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.color = color;
    }
  });
}

function getMeshes(obj) {
    const meshes = [];
    obj.traverse(child => {
        if (child.isMesh) meshes.push(child);
    });
    return meshes;
}

window.addEventListener('DOMContentLoaded', () => {
	//selectedSystem = document.getElementById('systemSelect').value;
	init();
	
	const nav = performance.getEntriesByType("navigation")[0];

	if (nav && nav.type === "reload") {
		const now = Date.now();
		const key = "data_last_refresh";
		const expire = 3 * 24 * 60 * 60 * 1000; // 3 days in ms
		const last = parseInt(localStorage.getItem(key) || "0", 10);

		let shouldReset = false;

		// No previous timestamp → reset and record
		if (!last) {
			shouldReset = true;
			console.log("No last refresh date found — resetting localStorage.");
		}

		// Older than time set in expire → reset
		else if (now - last > expire) {
			shouldReset = true;
			console.log("More than 3 days since last refresh — resetting localStorage.");
		}

		if (shouldReset) {
			localStorage.clear();
		}

		// Always set/update the timestamp
		localStorage.setItem(key, now.toString());
	}

	document.getElementById('systemSelect').addEventListener('change', () => {
		const system = document.getElementById('systemSelect').value;
		const theme = document.getElementById('ThemeSelect').value;

		selectedSystem = system;
		selectedTheme = theme;
		unloadSystem();
		loadSystem(); 
	});
	document.getElementById('ThemeSelect').addEventListener('change', () => {
		
		unloadSystem();
		const theme = document.getElementById('ThemeSelect').value;		
		selectedTheme = theme;
	
		themeHelper();		
		loadSystem(); 
	});
	
	let rmbDown = false;
	let rmbStart = { x: 0, y: 0 };

	renderer.domElement.addEventListener('mousedown', (event) => {
		if (event.button === 2) { // Right mouse button
			rmbDown = true;
			rmbStart = { x: event.clientX, y: event.clientY };
		}
	});

	renderer.domElement.addEventListener('mouseup', (event) => {
		if (event.button === 2 && rmbDown) {
			const dx = event.clientX - rmbStart.x;
			const dy = event.clientY - rmbStart.y;
			const dragDistance = Math.sqrt(dx * dx + dy * dy);
			if (dragDistance < 5) {
				goBack();
				
			}
			rmbDown = false;
		}
	});

	renderer.domElement.addEventListener('click', (event) => {
		mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = - (event.clientY / renderer.domElement.clientHeight) * 2 + 1;

		raycaster.setFromCamera(mouse, camera);

		const objectsToCheck = getMeshes(scene);
		const intersects = raycaster.intersectObjects(objectsToCheck, false); // children already flattened
			
		if (intersects.length > 0) {
			const clicked = intersects[0].object;

			//  Skip if it's the background sphere or any of its children
			if (bgSphere && bgSphere.children.includes(clicked) || bgSphere === clicked || bgSphere.children.some(c => c === clicked.parent)) {
				return; // ignore click
			}

			const posKm = clicked.position.clone().multiplyScalar(inverseScale);

			controls.target.copy(clicked.position);
			controls.update();
		}
	});

	renderer.domElement.addEventListener('contextmenu', (event) => {
		event.preventDefault(); // disable browser menu
	});
	
	animate();
});

// Time helper function
function get_current_rot(rotation_period_seconds) {
    const now = new Date();
    const elapsedRealSeconds = (now - serverEpoch) / 1000;
    const phase = elapsedRealSeconds % rotation_period_seconds;
    const rotationRadians = (phase / rotation_period_seconds) * 2 * Math.PI;

    return rotationRadians;
}

// ===== Canvas Setup (call this once during initialization) =====
let labelCanvas, labelCtx;

const updateCanvasSize = () => {
	const rect = renderer.domElement.getBoundingClientRect();
	labelCanvas.width = rect.width;
	labelCanvas.height = rect.height;
	labelCanvas.style.width = rect.width + 'px';
	labelCanvas.style.height = rect.height + 'px';
};
	
function initLabelCanvas(renderer) {
    labelCanvas = document.createElement('canvas');
    labelCanvas.style.position = 'absolute';
    labelCanvas.style.top = '0';
    labelCanvas.style.left = '0';
    labelCanvas.style.pointerEvents = 'none';
    labelCanvas.style.zIndex = '5';
    document.body.appendChild(labelCanvas);
    labelCtx = labelCanvas.getContext('2d');
    
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
	window.addEventListener("orientationchange", updateCanvasSize, false);
	document.addEventListener("fullscreenchange", updateCanvasSize, false);
    
    return labelCanvas;
}

// ===== POI List Mode State =====
let poiListMode = false;
let poiListModeActive = false; // actual state with hysteresis

// ===== Label Creator (with POI List-Mode Info Window) =====
const MAX_VISIBLE_POIS = 33;

// ------------------ Label Creation ------------------
function createLabel({
    x, y, z, position = null, name = '', theme = null, color = '#fff', fontSize = '14px',
    clickable = false, offset = { x: 0, y: 0 }, onClick = null, attachTo = null,
    fadeBehind = false, hoverInfo = null, angle = -20, angleDistance = 40, rotation = -20,
    showLine = true, lineColor = null, lineWidth = 1, lineDash = [5, 3], lineOpacity = 0.6,
    isPOI = false
}) {
    const div = document.createElement('div');
    div.classList.add('system-label');
    div.style.userSelect = 'none';
    div.style.position = 'absolute';
    div.style.fontSize = fontSize;
    div.style.pointerEvents = (clickable || isPOI) ? 'auto' : 'none';
    div.style.zIndex = '10';
    div.style.textShadow = '2px 2px 4px rgba(0,0,0,0.7)';
    div.style.whiteSpace = 'nowrap';
    div.style.maxWidth = 'none';
    div.style.width = 'auto';
    div.style.transformOrigin = 'left center';
    div.style.border = '1px solid rgba(0,0,0,0.8)';
    div.style.backgroundColor = 'rgba(0,0,0,0.2)';
    div.style.borderRadius = '3px';
    div.style.padding = '2px 4px';
    div.style.color = theme ? "#" + filterColorByTheme(0xffffff, theme).toString(16).padStart(6, '0') : color;
    div.style.cursor = clickable ? 'pointer' : 'default';

    if (clickable && typeof onClick === 'function') {
        div.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
    } else {
        div.addEventListener('click', e => e.stopPropagation());
    }

    // --- Text span ---
    const textSpan = document.createElement('span');
    textSpan.className = 'label-text';
    textSpan.innerText = name;
    div.appendChild(textSpan);

    // --- Tooltip ---
    if (!isPOI && hoverInfo) {
        const tooltip = document.createElement('div');
        tooltip.classList.add('label-tooltip');
        tooltip.innerHTML = hoverInfo;
        Object.assign(tooltip.style, {
            position: 'absolute', bottom: '100%', left: '50%',
            transform: 'translateX(-50%) translateY(0px)',
            background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '4px 8px',
            fontSize: '12px', borderRadius: '6px', whiteSpace: 'nowrap',
            pointerEvents: 'auto', display: 'none', zIndex: '100'
        });
        div.appendChild(tooltip);
        div.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
        div.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    }

    document.body.appendChild(div);

    // --- Position calculation ---
    const getPos = () => {
        if (attachTo && typeof attachTo.getWorldPosition === 'function') {
            const pos = new THREE.Vector3();
            attachTo.getWorldPosition(pos);
            return pos;
        }
        if (position && typeof position.clone === 'function') return position.clone();
        if (position) return new THREE.Vector3(position.x, position.y, position.z || 0);
        return new THREE.Vector3(x, y, z || 0);
    };

    const lineData = {
        visible: false, startX: 0, startY: 0, endX: 0, endY: 0,
        color: lineColor || color, width: lineWidth, dash: lineDash, opacity: lineOpacity
    };

    const metadata = {
        isPOI, originalName: name, screenX: 0, screenY: 0, centerDistance: Infinity,
        isFrontFacing: false, currentOpacity: 1, inTopTen: false
    };
	
	// --- POI info window setup (single shared window) ---
	let poiInfoWindow = document.getElementById('poi-info-window');
	if (!poiInfoWindow) {
		poiInfoWindow = document.createElement('div');
		poiInfoWindow.id = 'poi-info-window';
		poiInfoWindow.style.position = 'fixed';
		poiInfoWindow.style.left = '15%';
		poiInfoWindow.style.top = '50%';
		poiInfoWindow.style.transform = 'translateY(-50%)';
		poiInfoWindow.style.background = 'rgba(0,0,0,0.7)';
		poiInfoWindow.style.color = '#fff';
		poiInfoWindow.style.padding = '12px';
		poiInfoWindow.style.fontSize = '12px';
		poiInfoWindow.style.borderRadius = '8px';
		poiInfoWindow.style.maxWidth = '400px';
		poiInfoWindow.style.pointerEvents = 'auto';
		poiInfoWindow.style.display = 'none';
		poiInfoWindow.style.zIndex = '200';
		poiInfoWindow.style.overflow = 'auto';
		document.body.appendChild(poiInfoWindow);

		// --- Close button ---
		const closeBtn = document.createElement('div');
		closeBtn.innerText = '[close]';
		closeBtn.style.position = 'absolute';
		closeBtn.style.top = '4px';
		closeBtn.style.right = '4px';
		closeBtn.style.cursor = 'pointer';
		closeBtn.style.fontWeight = 'bold';
		closeBtn.style.color = '#fff';
		closeBtn.style.zIndex = '999';
		closeBtn.addEventListener('click', () => {
			poiInfoWindow.style.display = 'none';
		});
		poiInfoWindow.appendChild(closeBtn);

		// --- Content container ---
		const contentDiv = document.createElement('div');
		contentDiv.id = 'poi-info-content';
		contentDiv.style.marginTop = '20px'; // leave space for close button
		poiInfoWindow.appendChild(contentDiv);
	}

	// --- POI-specific metadata ---
	if (isPOI && hoverInfo) {
		Object.assign(metadata, {
			item_id: hoverInfo.item_id || '',
			System: hoverInfo.System || '',
			Planet: hoverInfo.Planet || '',
			PoiName: hoverInfo.PoiName || '',
			POI_Type: hoverInfo.Type || '',
			Classification: hoverInfo.Classification || '',
			Latitude: hoverInfo.Latitude || 0,
			Longitude: hoverInfo.Longitude || 0,
			Longitude360: hoverInfo.Longitude360 || 0,
			Altitude: hoverInfo.Height || 0,
			QTMarker: hoverInfo.QTMarker || 0,
			NextPOI: hoverInfo.NextPOI || '',
			NextQTMarker: hoverInfo.NextQTMarker || '',
			Description: hoverInfo.Description || '',
			POI_Faction: hoverInfo.POI_Faction || '',
			POI_Subtype: hoverInfo.POI_Subtype || '',
			POI_Entries: hoverInfo.POI_Entries || '',
			POI_Accessable_Foot: hoverInfo.POI_Accessable_Foot || 0,
			POI_Accessable_Vehicle: hoverInfo.POI_Accessable_Vehicle || 0,
			POI_Accessable_Ship: hoverInfo.POI_Accessable_Ship || 0,
			POI_Defenses: hoverInfo.POI_Defenses || '',
			POI_LandingPads: hoverInfo.POI_LandingPads || 0,
			POI_VehiclePads: hoverInfo.POI_VehiclePads || 0,
			POI_FreightElevator: hoverInfo.POI_FreightElevator || '',
			POI_Terminals: hoverInfo.POI_Terminals || 0,
			POI_MedBay: hoverInfo.POI_MedBay || 0,
			POI_Services: hoverInfo.POI_Services || 0,
			POI_NPCs: hoverInfo.POI_NPCs || '',
			POI_Atmosphere: hoverInfo.POI_Atmosphere || 0,
			ZONE_Armistice: hoverInfo.ZONE_Armistice || 0,
			ZONE_NoFly: hoverInfo.ZONE_NoFly || 0,
			ZONE_Trespassing: hoverInfo.ZONE_Trespassing || 0,
			ZONE_Biome: hoverInfo.ZONE_Biome || '',
			ZONE_Gravitation: hoverInfo.ZONE_Gravitation || 0,
			ZONE_Temperature_Min: hoverInfo.ZONE_Temperature_Min || '',
			ZONE_Temperature_Max: hoverInfo.ZONE_Temperature_Max || '',
			Minerals: hoverInfo.Minerals || '',
			SpecialLoot: hoverInfo.SpecialLoot || '',
			Missions: hoverInfo.Missions || ''
		});

		// --- Hover info ---
		div.addEventListener('mouseenter', () => {
			if (div.style.display !== 'none') {
				poiInfoWindow.style.display = 'block';
				const contentDiv = document.getElementById('poi-info-content');
				let cleanName = metadata.originalName ? String(metadata.originalName).replace(/_/g,' ') : '';
				let html = `<strong>${cleanName}</strong><br>`;
				for (const key in metadata) {
					if (['originalName','inTopTen','screenX','screenY','centerDistance','currentOpacity','isFrontFacing','listX','listY'].includes(key)) continue;
					const value = metadata[key];
					html += `${key}: ${value !== undefined && value !== null ? String(value).replace(/_/g,' ') : ''}<br>`;
				}
				contentDiv.innerHTML = html;
			}
		});

	}

    // --- Label updater ---
    const labelUpdater = () => {
        const pos = getPos();
        const vector = pos.clone().project(camera);
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const screenX = (vector.x + 1) / 2 * rect.width;
        const screenY = (1 - vector.y) / 2 * rect.height;

        metadata.screenX = screenX;
        metadata.screenY = screenY;

        let currentOpacity = 1.0;
        let isFrontFacing = true;

        if (fadeBehind) {
            const camDir = pos.clone().sub(camera.position).normalize();
            const planetNormal = pos.clone().normalize();
            const dot = camDir.dot(planetNormal);
            currentOpacity = Math.max(0.2, -dot);
            isFrontFacing = dot < 0;
        } else if (vector.z < -1 || vector.z > 1) {
            isFrontFacing = false;
        }

        metadata.isFrontFacing = isFrontFacing;
        metadata.currentOpacity = currentOpacity;
        metadata.centerDistance = Math.sqrt(Math.pow(screenX - rect.width / 2, 2) + Math.pow(screenY - rect.height / 2, 2));

        let finalX, finalY;
        if (isPOI && poiListModeActive && metadata.inTopTen) {
            finalX = metadata.listX || screenX;
            finalY = metadata.listY || screenY;
        } else {
            const angleRad = angle * Math.PI / 180;
            finalX = screenX + offset.x + Math.cos(angleRad) * angleDistance;
            finalY = screenY + offset.y + Math.sin(angleRad) * angleDistance;
        }

        div.style.left = `${finalX + rect.left}px`;
        div.style.top = `${finalY + rect.top}px`;
        div.style.transform = `translate(0, -50%) rotate(${rotation}deg)`;

        if (!isFrontFacing || (isPOI && poiListModeActive && !metadata.inTopTen)) {
            div.style.display = 'none';
            lineData.visible = false;
        } else {
            div.style.display = 'block';
            div.style.opacity = currentOpacity;
        }

        if (showLine && div.style.display !== 'none') {
            lineData.visible = true;
            lineData.startX = screenX;
            lineData.startY = screenY;
            lineData.endX = finalX;
            lineData.endY = finalY;
            lineData.opacity = currentOpacity * lineOpacity;
        } else {
            lineData.visible = false;
        }
    };

    animateCallbacks.push(labelUpdater);

    if (attachTo) {
        attachTo.label = div;
        attachTo.updateLabel = labelUpdater;
        attachTo.lineData = lineData;
    }

    div.lineData = lineData;
    div.metadata = metadata;
    div.updateLabel = labelUpdater;
    return div;
}

// ------------------ POI Visibility Limiter ------------------
function updatePOIVisibility() {
    if (poiListModeActive) return; // list mode handled separately

    const labels = document.querySelectorAll('.system-label');
    const poiLabels = Array.from(labels).filter(l => l.metadata && l.metadata.isPOI && l.metadata.isFrontFacing);

    // Sort by fade priority (higher opacity first)
    poiLabels.sort((a, b) => b.metadata.currentOpacity - a.metadata.currentOpacity);

    poiLabels.forEach((label, index) => {
        if (index < MAX_VISIBLE_POIS) {
            if (label.style.display === 'none') label.style.display = 'block';
        } else {
            label.style.display = 'none';
            label.lineData.visible = false;
        }
    });
}
// ===== Update POI List (call this in animation loop) =====
function updatePOIListMode() {
    if (!firstBody) return;

    // Calculate distance with hysteresis
    const camDistance = camera.position.length();
    const threshold = 3 * firstBody.radius_km * scale;
    const hysteresisBuffer = firstBody.radius_km * scale*0.5;

    if (!poiListModeActive && camDistance > threshold) {
        poiListModeActive = true;
    } else if (poiListModeActive && camDistance < (threshold - hysteresisBuffer)) {
        poiListModeActive = false;
    }

    if (!poiListModeActive) {
        // Reset all POI flags and force update
        const labels = document.querySelectorAll('.system-label');
        labels.forEach(label => {
            if (label.metadata && label.metadata.isPOI) {
                label.metadata.inTopTen = false;
                // Force immediate update to return to normal position
                if (label.updateLabel) {
                    label.updateLabel();
                }
            }
        });
        return;
    }

    // Get all POI labels
    const labels = document.querySelectorAll('.system-label');
    const poiLabels = Array.from(labels).filter(l => 
        l.metadata && l.metadata.isPOI && l.metadata.isFrontFacing
    );

    // Sort by distance from center, take top 10
    poiLabels.sort((a, b) => a.metadata.centerDistance - b.metadata.centerDistance);
    const topTen = poiLabels.slice(0, 18);

    // Sort top 10 by Y position (top to bottom)
    topTen.sort((a, b) => a.metadata.screenY - b.metadata.screenY);

    // Reset all inTopTen flags
    poiLabels.forEach(l => l.metadata.inTopTen = false);

    // Position the top 10 in a list
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const listX = rect.width * 0.75; // 95% from left (5% from right)
    const listStartY = rect.height * 0.15; // 15% from top
    const listSpacing = 28; // pixels between each entry

    topTen.forEach((label, index) => {
        label.metadata.inTopTen = true;
        label.metadata.listX = listX;
        label.metadata.listY = listStartY + (index * listSpacing);
    });
}

// ===== Draw all label lines (in animation loop) =====
function drawAllLabelLines() {
    if (!labelCtx) return;
    
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    
    const labels = document.querySelectorAll('.system-label');
    labels.forEach(label => {
        const data = label.lineData;
        if (!data || !data.visible) return;
        
        labelCtx.save();
        labelCtx.strokeStyle = "#" + filterColorByTheme(0xffffff, selectedTheme).toString(16).padStart(6, '0');
        labelCtx.lineWidth = data.width;
        labelCtx.globalAlpha = data.opacity;
        
        if (data.dash.length > 0) {
            labelCtx.setLineDash(data.dash);
        }
        
        labelCtx.beginPath();
        labelCtx.moveTo(data.startX, data.startY);
        labelCtx.lineTo(data.endX, data.endY);
        labelCtx.stroke();
        
        labelCtx.restore();
    });
}

function changeFontForSystemLabel(fontFamily) {
  const labels = document.querySelectorAll('.system-label');
  labels.forEach(label => {
    label.style.fontFamily = fontFamily;
  });
}

function filterColorByTheme(color, theme) {

    if (typeof color === 'string' && color.startsWith('#')) {
        color = parseInt(color.substring(1), 16);
    }

    let r = (color >> 16) & 0xff;
    let g = (color >> 8) & 0xff;
    let b = color & 0xff;
    
    // Define theme tints
    const themes = {
        "Amber": { r: 1.0, g: 0.8, b: 0.6 },    // Warm orange-ish
        "Cool": { r: 0.6, g: 0.9, b: 1.0 }, 	// Cool blue-ish
        "Hot": { r: 1.0, g: 0.7, b: 0.7 }, 		// Warm red-ish
        "Green": { r: 0.1, g: 1.0, b: 0.3 }, 	// Green-ish
        "Default": { r: 1.0, g: 1.0, b: 1.0 }   // No change
    };

    const tint = themes[theme] || themes["Default"];

    // Apply tint
    r = Math.min(255, Math.round(r * tint.r));
    g = Math.min(255, Math.round(g * tint.g));
    b = Math.min(255, Math.round(b * tint.b));
    
    return (r << 16) | (g << 8) | b;
}

function goBack() {	
	const origin = selectedSystem; // store the original value
	console.log(`Back, Origin system was: ${origin}`);
	
	onSystemChange(selectedSystem.split('/').slice(0, -1).join('/'));
	console.log(`changed to: ${selectedSystem}`);
	
	unloadSystem();
	loadSystem(origin); // pass original value
	parent.otherIframeFunction("system_" + selectedSystem);
}		

function orbitalToCartesian({ distance, inc, asc, angle3 }) {

  const i = inc   * Math.PI / 180;
  const Ω = asc   * Math.PI / 180;
  const u = angle3 * Math.PI / 180;

  // position in orbital plane
  const xOrb = distance * Math.cos(u);
  const yOrb = distance * Math.sin(u);

  // rotate from orbital → reference frame
  const x =  xOrb * ( Math.cos(Ω) )
           - yOrb * ( Math.sin(Ω) * Math.cos(i) );
  const y =  xOrb * ( Math.sin(Ω) )
           + yOrb * ( Math.cos(Ω) * Math.cos(i) );
  const z =  yOrb * Math.sin(i);

  return { x, y, z };
}

function createSkySphere(scene, pngUrl) {
    const geometry = new THREE.SphereGeometry(1e6, 64, 64); // huge sphere
    const loader = new THREE.TextureLoader();

    loader.load(pngUrl, (texture) => {
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.BackSide // render inside of sphere
        });
        const sphere = new THREE.Mesh(geometry, material);

        // Make the sphere unclickable
        sphere.raycast = () => {}; // disables raycasting entirely

        scene.add(sphere);
    });
}

// MAIN scene (un)load
function unloadSystem() {
	console.clear();
	//reset_terminal(document.getElementById('retroContent'));
    // Remove everything from the scene
    while (scene.children.length > 0) {
        const obj = scene.children[0];
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
    }

    // Remove all dynamic labels (divs)
    document.querySelectorAll('.system-label').forEach(el => el.remove());

    // Clear animate callbacks
    animateCallbacks.length = 0;
	
	//  Reset group state so updateGroupPositions() can rebuild properly
    groupMarkers = {};
    playerColors = {};
	systemPlayers = {};
	objects = {};
	
    console.log('System cleared, all data removed, callbacks reset');
}

function loadSystem(origin) {
	
	const selSys = selectedSystem
    .replace(/\/\//g, "/")   // replace all double slashes 
    .replace(/^\/+/, "");  // remove leading slash
	
	createSkySphere(scene, "/static/nebulae.png" );
	console.log(`loading system: /system/${selSys}`);
	if (origin) {
		console.log(`Origin system was: ${origin}`);
	}

	stopAnimation(); // Stop any running animation

	const finishLoading = (bodies) => {
		handleSystemData(bodies, origin);
			startAnimation()
			startTracking();
	};

	if (selSys === "") {
		fetch('/system')
			.then(res => res.json())
			.then(data => {
				renderSystemGraph(data);
					startAnimation()
					startTracking();
			});
		return;
	}

	const cached = localStorage.getItem(`system_${selSys}`);
	if (cached) {
		console.log(`Loaded ${selSys} from localStorage`);
		const bodies = JSON.parse(cached);
		finishLoading(bodies);
	} else {
		fetch(`/system/${selSys}`)
			.then(res => res.json())
			.then(bodies => {
				console.log(`Fetched /system/${selSys} from server`);
				localStorage.setItem(`system_${selSys}`, JSON.stringify(bodies));
				finishLoading(bodies);
			});
	}
}

function formatRotationPeriod(seconds) {
    const days = Math.floor(seconds / 86400); // 24*60*60
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let str = "";
    if (days > 0) str += days + "d ";
    if (hours > 0 || days > 0) str += hours + "h ";
    if (minutes > 0 || hours > 0 || days > 0) str += minutes + "m ";
    str += seconds + "s";

    return str;
}

let objects = {};

function handleSystemData(bodies,origin) {
	
	createBGsphere();
	
    const light = new THREE.PointLight(0xffffff, 1.5);
    
    ifmap = "";
    firstBody = bodies[0];	
	
    if (firstBody) {						
		const result = setupFirstBody(firstBody, selectedSystem, scene);
		scale = result.scale;
		inverseScale = result.inverseScale;
		
	}

	// direction vector from target to camera before scene reload
	const newTarget = new THREE.Vector3(0, 0, 0);

	// Compute current direction from camera to old target
	const dir = new THREE.Vector3()
		.subVectors(camera.position, controls.target) // vector from old target to cam
		.normalize();

	// Compute desired distance from origin
	let newDist;
	if (selectedSystem.includes("map")) {
		newDist = (firstBody.radius_km * scale) * 3.1;
		newMinDist = (firstBody.radius_km * scale) * 1.3;
	} else {
		newDist = firstBody.radius * 8;
		newMinDist = firstBody.radius * 3;
	}

	// Reposition camera along same direction relative to new target
	camera.position.copy(dir.multiplyScalar(newDist).add(newTarget));

	// Update OrbitControls target
	controls.minDistance = newMinDist;
	controls.target.copy(newTarget);
	controls.update();
	
	let orbit;
	
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i];
		
		let imap = ifmap;
		if((body.type==='planet')&&(firstBody.type==='planet')){
			console.log(`firstBody is planet.`);
			imap = "/map";
		}	
		if((body.type==='moon')&&(firstBody.type==='moon')){
			console.log(`firstBody is moon.`);
			imap = "/map";
		}	
		console.log(`${i}: ${body.name}`);

		let x = 0;
		let y = 0;
		let z = 0;	

		const dist = body.distance || 0;
		const angleRad = (body.angle3 || 0) * Math.PI / 180;	
		
		// we only use actual radius when we are close up, or they would be invisible 
		let radius;
		if (selectedSystem.includes("map")){
			radius = body.radius_km*scale
		}
		else{
			if (firstBody.type==="star"&&(i>0)){
				radius = body.radius*0.5;
			}
			else{
				radius = body.radius
			}
		}		
		
		// for all except first = parent = [0,0,0].
		if(i!==0){ 
		
			const rawDist = dist * scale;
			const localX = Math.cos(angleRad) * rawDist;
			const localY = Math.sin(angleRad) * rawDist;
			const localZ = 0;
			
			// if data XYZ 
			if(body.X!=0){ 
				x = (body.X-bodies[0].X)* scale *0.001; // m=>km
				y = (body.Y-bodies[0].Y)* scale *0.001;
				z = (body.Z-bodies[0].Z)* scale *0.001;		
			}
			else{
				// Create a local vector
				const position = new THREE.Vector3(localX, localY, localZ);

				// Prepare rotation matrices
				const inclinationMatrix = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(body.inc || 0));
				const ascendingNodeMatrix = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(body.asc || 0));

				// Apply rotations
				position.applyMatrix4(inclinationMatrix);
				position.applyMatrix4(ascendingNodeMatrix);

				// The calculated x,y,z
				x = position.x;
				y = position.y;
				z = position.z;				
			}
			
			// Draw Orbits
			if ( (dist > 0)&&((body.type!=="belt")&&(body.type!=="parent")&&(body.type!=="city")&&(body.type!=="star")&&(body.type!=="gateway")&&(body.type!=="spacestation")) ) {
				orbit = drawOrbit(dist,body.inc,body.asc);
			}
			if (body.type==="parent"){
				orbit = drawOrbit(firstBody.distance, firstBody.inc, firstBody.asc, [x, y, z]);	
			}
			if (body.type==="parent"||body.type==="planet"||body.type==="moon"){
				console.log(`Distance to firstBody: ${body.distance}`);						
			}
		}

		// create body
		const geometry = new THREE.SphereGeometry(radius, 64, 64);		
		let material;

		// base material (fallback)
		const baseColor = filterColorByTheme(body.color, selectedTheme);
		material = new THREE.MeshStandardMaterial({ color: baseColor });

		if ( (body.type === 'planet'||body.type==="moon"||body.type==="parent") ) {  
			const texturePath = `/static/textures/${body.name}.png`;

			const loader = new THREE.TextureLoader();
			loader.load(
				texturePath,
				(texture) => {
					material.map = texture;
					material.needsUpdate = true;
				},
				undefined,
				() => {
					console.log(`No texture for ${firstBody.name}, using color only.`);
				}
			);
		}
		
		if (body.type === 'star') { material = new THREE.MeshBasicMaterial({ color: baseColor }); 		}

		geometry.rotateX(Math.PI / 2);
		const sphere = new THREE.Mesh(geometry, material);
		
		sphere.position.set(x, y, z);
		
		// Check if it's a city and attach to parent
		if (body.type === 'city') {
			const parentId = body.parent.split('/').pop();
			console.log("type is:", firstBody.type);
			if (objects[parentId] && objects[parentId].sphere) {
				
				objects[parentId].sphere.add(sphere); // Attach city to planet
			} else {
				console.warn("Planet data not found in objects[parentId]");
			}
		} else if ((body.type === 'spacestation')&&(body.locked==='true')) {
			const parentId = body.parent.split('/').pop();
			if (objects[parentId] && objects[parentId].sphere) {				
				objects[parentId].sphere.add(sphere); // Attach ss to planet
				objects[parentId].sphere.add(orbit);
			} else {
				console.warn("Planet data not found in objects[parentId]");
			}
		}else if ( (body.type === 'planet')||(body.type === 'moon')||(body.type === 'parent')||(body.type === 'star') ) {
			scene.add(sphere);
		}		
		
		// attach noneOrbital locater lines
		if ((body.type === 'gateway') && (firstBody.type==="star")) {	
			noneOrbital([x,y,z],[0,0,0]);
		}
		
		// add spacestation icon
		if ((body.type === 'gateway')||(body.type==="spacestation")) {	
			const station = createSpaceStationIcon(x,y,z);
			scene.add(station);
		}
		
		// attach day cycle animation
		if ((body.type === 'planet' || body.type === 'moon')&&(firstBody.type!=="star")) {	
			makeRotatingBody(body, sphere);
		}
		
		objects[body.id] = { sphere, x, y, z, dist, angle: angleRad, name: body.name };		
				
		// LaGrange Points
		if ((body.type === 'planet')&&(firstBody.type === 'star')) {				
			draw_lagrangepoints({ body, firstBody, angleRad, scale, scene, selectedTheme });
		}	

		if (body.type === 'belt') {

			const inner = body.distance || 0;
			const outer = inner + (body.radius || 0);
			
			drawBelt({
				innerRadius: inner,
				outerRadius: outer,
				center: [0, 0, 0],
				color: filterColorByTheme(body.color,selectedTheme),
				opacity: 0.5
			});
		}	

		// Labels
		if ((body.type === 'star')||(body.type === 'planet')||(body.type === 'moon')||(body.type === 'parent')) {
			createLabel({
				x, y, z,
				name: body.name,
				theme: selectedTheme,
				fontSize: '14px',
				clickable: true,
				offset: { x: 48, y: -8 },
				attachTo: objects[body.id].sphere, 
				onClick: () => {
					const origin = selectedSystem; // store the original value
					onSystemChange( `${body.parent}/${body.name.toLowerCase()}${imap}`);
					parent.otherIframeFunction("system_" + selectedSystem);
					unloadSystem();
					loadSystem(origin);
				},
				hoverInfo:`Type: ${body.type}<br>Radius: ${body.radius_km} km<br>Sidereal day: ${formatRotationPeriod(body.rotation_period)}<br>`
			});
		}else{
			createLabel({
				x, y, z,
				name: body.name,
				theme: selectedTheme,
				fontSize: '10px',
				clickable: false,
				offset: { x:35, y: -14 },
				attachTo: objects[body.id].sphere,
				hoverInfo:body.type
			});					
		}		
	};
	
	// For planets and moons in map mode only
	if ( (firstBody.type === 'planet' || firstBody.type === 'moon') && (selectedSystem.includes("map")) ){   

		console.log(`found ${firstBody.type} for POI points`);
		console.log(`${selectedSystem} ${firstBody.radius_km * scale}`);
		
		// Load PoI's
		loadPOIs(selectedSystem,objects,((firstBody.radius_km * scale)*1.001),firstBody.id);

		console.log(`found ${firstBody.type} for OM points`);
		const OMdist = firstBody.radius_km * 1.45; // no scale here
		const OMradius = (firstBody.radius_km * 0.004)*scale;

		// Define all 6 OM points with direction vectors
		const OMPoints = [
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM1`, vec: new THREE.Vector3( 0, 0,  OMdist) }, // +Z
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM2`, vec: new THREE.Vector3( 0, 0, -OMdist) }, // -Z
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM6`, vec: new THREE.Vector3( OMdist, 0,  0) }, // +X
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM4`, vec: new THREE.Vector3( 0,  OMdist, 0) }, // +Y
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM5`, vec: new THREE.Vector3(-OMdist, 0,  0) }, // -X
			{ name: `${firstBody.name.slice(0, 3).toUpperCase()}-OM3`, vec: new THREE.Vector3( 0, -OMdist, 0) }  // -Y
		];

		console.log(`created OM points for planet or moon`);

		let omC =0;
		OMPoints.forEach(point => {
			const OMdot = new THREE.Mesh(
				new THREE.SphereGeometry(OMradius, 8, 8),
				new THREE.MeshBasicMaterial({ color: filterColorByTheme(0xffffff, selectedTheme) })
			);

			// Place the OMdot relative to planet center
			OMdot.position.copy(point.vec.multiplyScalar(scale));
			objects[firstBody.id].sphere.add(OMdot); // Attach OM point to planet
			
			createLabel({
				x: OMdot.position.x, 
				y: OMdot.position.y, 
				z: OMdot.position.z,
				name: point.name,
				theme: selectedTheme,
				fontSize: '10px',
				clickable: false,
				offset: { x:35, y: -14 },
				attachTo: OMdot,
				hoverInfo: "OM Point"
			});		
			
			omC++;

		});		
		
		//create OM ring
		circleA = drawOrbit(OMdist,  0,  0,  [0, 0, 0])
		circleB = drawOrbit(OMdist,  90,  0,  [0, 0, 0])
		circleC = drawOrbit(OMdist,  90,  90,  [0, 0, 0])
		objects[firstBody.id].sphere.add(circleA); // Attach to planet
		objects[firstBody.id].sphere.add(circleB); 
		objects[firstBody.id].sphere.add(circleC); 
				
	}

	// XYZ
	add_line([1500,0,0],[-1500, 0, 0], filterColorByTheme(0xbb2222,selectedTheme) );
	add_line([0,1500,0],[ 0,-1500, 0], filterColorByTheme(0x22bb22,selectedTheme) );
	add_line([0,0, -100],[ 0, 0, 100], filterColorByTheme(0x2222bb,selectedTheme) );
	
	// create some BG stars
	if ((selectedSystem !== "")&&(!selectedSystem.includes("map")) ) {
		fetch('/system')
			.then(res => res.json())
			.then(data => {
				renderSystemGraphBG(data);
			});
		return;
	}
	
	updateGroupPositions(firstBody);
	bringConsoleToFront();
}

// ### ANIMATION BLOCK ###
// avoid multiple intervals
function startTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => updateGroupPositions(firstBody), 1500);
}

function makeRotatingBody(body, sphere) {
    const baseRotation = new THREE.Euler(); // store initial geometry rotation if needed
    animateCallbacks.push(() => {
        const offsetRad = body.rotation_offset * Math.PI / 180;
        const rot = offsetRad + get_current_rot(body.rotation_period);

        // Rotate around Z axis (or Y depending on SC spin axis)
        sphere.rotation.z = rot; // keeps geometry tilt from rotateZ intact
    });
}

function startAnimation() {
	if (!running) {
		running = true;
		animate();
	}
}

function stopAnimation() {
	running = false;
}

let lastWidth = window.innerWidth;
let lastHeight = window.innerHeight;

function checkResize() {
    if (window.innerWidth !== lastWidth || window.innerHeight !== lastHeight) {
        lastWidth = window.innerWidth;
        lastHeight = window.innerHeight;
        onWindowResize();
		updateCanvasSize();
    }
}

let frameCount = 0;
function animate() {
	if (!running) return;
	
	frameCount++;
	if (frameCount % 60 === 0) {  // ~once per second at 60 FPS
		checkResize();
	}

	selectedTheme = document.getElementById('ThemeSelect').value;
	
	for (const id in groupMarkers) {
		const m = groupMarkers[id];
		if (m.targetPos) {
			m.marker.position.lerp(m.targetPos, 0.2);
			m.wireframeSphere.position.lerp(m.targetPos, 0.2);
		}
	}
	
	const t = performance.now() * 0.001;

	for (const id in groupMarkers) {
		const m = groupMarkers[id];
		const rings = m.wireframeSphere;
		if (!rings) continue;

		// Center rings on player marker
		rings.position.copy(m.marker.position);

		// Animate the oscillating ring along Z
		const movingRing = rings.children.find(r => r.userData.oscillate);
		if (movingRing) {
			const speed = 2.5;
			const amplitude = 0.25; // distance from center (matches ringOffset)
			const wave = Math.sin(t * speed) * amplitude;
			movingRing.position.z = wave;

			// Scale largest at middle (wave = 0), smallest at extremes
			const scale = 0.8 + (1 - Math.abs(wave / amplitude)) * 0.4; // 0.8–1.2
			movingRing.scale.set(scale, scale, scale);
		}

		// Optional subtle rotation for flair (or remove if static)
		// rings.rotation.y += 0.005;
	}
	
    requestAnimationFrame(animate);
	updatePOIVisibility();

    updatePOIListMode();  // Check distance and update list
	drawAllLabelLines();
    renderer.render(scene, camera);
	
    animateCallbacks.forEach(cb => cb());
    if (controls && controls.update) controls.update(0.016);
}

// ############ POI Block ###############

const pois = {};
async function loadPOIs(selectedSystem,objects,radius,id) {
    if (!selectedSystem.endsWith("/map")) return;

    const parts = selectedSystem.split("/");
    const systemName = parts[0];                 // "stanton", "pyro"
    const bodyName = parts[parts.length - 2];    // planet or moon

    if (!pois[selectedSystem]) {
        try {
            const response = await fetch(`/static/POI/${systemName}.json`);
            if (!response.ok) throw new Error(`Failed to fetch ${systemName}.json`);
            const data = await response.json();

            // Filter by system + planet
            pois[selectedSystem] = data.filter(poi =>
                poi.System.toLowerCase() === systemName.toLowerCase() &&
                poi.Planet.toLowerCase() === bodyName.toLowerCase()
            );
        } catch (err) {
            console.error("Error loading POI file:", err);
            return;
        }
    }

    const poiList = pois[selectedSystem];
    if (!poiList.length) {
        console.warn("No POIs for", systemName, bodyName);
        return;
    }

    const parentObj = objects[id];
    if (!parentObj || !parentObj.sphere) {
        console.warn("Parent body not found:", systemName, id);
        return;
    }

	 poiList.forEach(poi => {
		const lat = THREE.MathUtils.degToRad(poi.Latitude);
		const lon = THREE.MathUtils.degToRad(poi.Longitude);

		// Use Height (in same units as radius, e.g., meters)
		const alt = (poi.Height*0.001*scale || 0);   // default 0 if missing

		const r = radius + alt;          // radius + altitude

		const x = r * Math.cos(lat) * Math.cos(lon);
		const y = r * Math.cos(lat) * Math.sin(lon);
		const z = r * Math.sin(lat);     // Z is vertical

		// POI dot
		const geometry = new THREE.SphereGeometry(0.08, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: filterColorByTheme(0xaaaaee, selectedTheme) });
		const dot = new THREE.Mesh(geometry, material);
		dot.position.set(x, y, z);
		parentObj.sphere.add(dot);

		// Label
		createLabel({
			x, y, z,
			name: poi.PoiName,
			theme: selectedTheme,
			fontSize: '12px',
			clickable: false,
			offset: { x: 100, y: -30 },
			attachTo: dot,
			isPOI: true,
			hoverInfo: poi,
			fadeBehind: true
		});
	});

    console.log(`Loaded ${poiList.length} POIs for ${systemName}/${bodyName}`);
}

// prep for first body
function setupFirstBody(firstBody, selectedSystem, scene) { 
    if (!firstBody) return;
	const baseColor = filterColorByTheme(firstBody.color, selectedTheme);
    const light = new THREE.PointLight(baseColor, 1.5);
    let scale, inverseScale;
    let ifmap = "";

    const setScale = (s) => {
        scale = s;
        inverseScale = 1 / scale;
        console.log(`set scale: ${scale}, inverse: ${inverseScale}`);
    };

    switch (firstBody.type) {
        case 'star':
            ifmap = "";
            console.log(`starsystem, setting up ${firstBody.name}`);
            setScale(1e-6);

            // sun Light at origin
            light.position.set(0, 0, 0);
			
            console.log(`created star`);
            break;

        case 'planet':
            ifmap = "";
            console.log(`planetsystem, setting up ${firstBody.name}`);
            setScale(Math.pow(10, -3.5));

            const angx = Math.cos(firstBody.angle3 * Math.PI / 180);
            const angy = Math.sin(firstBody.angle3 * Math.PI / 180);
            const posX = -angx * firstBody.distance * scale;
            const posY = -angy * firstBody.distance * scale;

            light.position.set(posX, posY, 0);

            createParentStar(300, 100000, posX, posY, 0);
            console.log(`created parent star`);
            break;

        case 'moon':
            ifmap = "/map";
            console.log(`moonsystem, setting up ${firstBody.name}`);
            setScale(1e-3);

            const moonX = -firstBody.X * scale * 0.01;
            const moonY = -firstBody.Y * scale * 0.01;
            light.position.set(moonX, moonY, 0);

            createParentStar(10000, 100000, moonX, moonY, 0);
            console.log(`created parent star`);
            break;

        default:
            console.warn(`Unknown firstBody type: ${firstBody.type}`);
            break;
    }

    // Adjust scale if viewing map
    if (selectedSystem.includes("map")) {
        if (firstBody.type === 'moon' || firstBody.type === 'planet') {
            setScale(Math.pow(10, -2.0));
        }
    }

    // Override light position if coordinates exist
    if (firstBody.X != 0) {
        light.position.set(-firstBody.X * 0.001, -firstBody.Y * 0.001, -firstBody.Z * 0.001);
    }

    scene.add(light);

    // Optionally create the planet sphere if in map view
    if (selectedSystem.includes("map") && (firstBody.type === 'planet' || firstBody.type === 'moon')) {
        const wire_radius = firstBody.radius_km * scale * 1.005;
        createPlanetSphere(wire_radius, firstBody);
    }

    return { scale, inverseScale, light, ifmap };
}

// #### #d objects and helpers ####

function createSpaceStationIcon(x, y, z) {
    const group = new THREE.Group();

    const material = new THREE.LineBasicMaterial({
        color: filterColorByTheme(0xffffff, selectedTheme)
    });

    // ----- MAIN LINE ALONG Z (length 3) -----
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 0, 1)
    ]);
    const verticalLine = new THREE.Line(lineGeometry, material);
    group.add(verticalLine);

    // ----- CIRCLE IN X-Y PLANE at Z = 3 -----
    const radius = 0.5;
    const segments = 16;
    const circlePoints = [];

    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI *2 ;
        circlePoints.push(
            new THREE.Vector3(
                Math.cos(a) * radius,
                Math.sin(a) * radius,
                0.5
            )
        );
    }

    const circleGeometry = new THREE.BufferGeometry().setFromPoints(circlePoints);
    const circle = new THREE.LineLoop(circleGeometry, material);
    group.add(circle);

    // ----- SET POSITION -----
    group.position.set(x, y, z);

    return group;
}

function drawOrbit(distance, inclination = 0, ascendingNode = 0, center = [0, 0, 0]) {
    const segments = 256;
    const radius = distance * scale;

    const orbitGeometry = new THREE.BufferGeometry();
    const points = [];

    // Convert angles from degrees to radians
    const inclinationRad = THREE.MathUtils.degToRad(inclination);
    const ascendingNodeRad = THREE.MathUtils.degToRad(ascendingNode);

    // Prepare rotation matrices
    const inclinationMatrix = new THREE.Matrix4().makeRotationX(inclinationRad);
    const ascendingNodeMatrix = new THREE.Matrix4().makeRotationZ(ascendingNodeRad);

    const centerVec = new THREE.Vector3(center[0], center[1], center[2]);

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        const x = radius * Math.cos(theta);
        const y = radius * Math.sin(theta);
        const z = 0;

        const point = new THREE.Vector3(x, y, z);

        // Apply orbit plane rotations
        point.applyMatrix4(inclinationMatrix);
        point.applyMatrix4(ascendingNodeMatrix);

        // Offset to orbit center
        point.add(centerVec);

        points.push(point);
    }

    orbitGeometry.setFromPoints(points);

    const orbitMaterial = new THREE.LineDashedMaterial({
        color: filterColorByTheme(0xaaaaee, selectedTheme),
        dashSize: 2,
        gapSize: 2,
		transparent: true,  
		opacity: 0.5  
    });

    const orbit = new THREE.Line(orbitGeometry, orbitMaterial);
    orbit.computeLineDistances(); // Required for dashed lines
    scene.add(orbit);

    return orbit;
}

function draw_lagrangepoints({
    body,           // planet object
    firstBody,      // star object
    angleRad,       // base orbit angle of planet
    scale = 1,      // map scaling factor
    scene,          // three.js scene
    selectedTheme   // current theme for colors
}) {
    // Only draw for planets orbiting a star
    if (body.type !== 'planet' || firstBody.type !== 'star') return;

    console.log(`Created Lagrange points for planet: ${body.name}`);

    const lagrangeDistance = body.distance * 0.1;

    const lagrangePoints = [
        { name: `${body.name.slice(0, 3).toUpperCase()}-L1`, offset: -lagrangeDistance },
        { name: `${body.name.slice(0, 3).toUpperCase()}-L2`, offset: lagrangeDistance },
        { name: `${body.name.slice(0, 3).toUpperCase()}-L3`, angleOffset: Math.PI },
        { name: `${body.name.slice(0, 3).toUpperCase()}-L4`, angleOffset: Math.PI / 3 },
        { name: `${body.name.slice(0, 3).toUpperCase()}-L5`, angleOffset: -Math.PI / 3 }
    ];

    lagrangePoints.forEach(point => {
        let xL, yL;

        if (point.offset !== undefined) {
            const dirX = Math.cos(angleRad);
            const dirY = Math.sin(angleRad);
            const lDist = body.distance + point.offset;
            xL = dirX * lDist * scale;
            yL = dirY * lDist * scale;
        } else if (point.angleOffset !== undefined) {
            const angle = angleRad + point.angleOffset;
            xL = Math.cos(angle) * body.distance * scale;
            yL = Math.sin(angle) * body.distance * scale;
        }

        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.125, 8, 8),
            new THREE.MeshBasicMaterial({ color: filterColorByTheme(0xffffff, selectedTheme) })
        );
        dot.position.set(xL, yL, 0);
        scene.add(dot);

        createLabel({
            x: xL, y: yL,
            name: point.name,
            theme: selectedTheme,
            fontSize: '10px',
            clickable: false,
            offset: { x: 0, y: -9 }
        });
    });
}

// Draw a dashed line between two 3D points with optional color
function add_line(start, end, color = 0x66ff66) {
    const points = [];

    // Convert array [x,y,z] into THREE.Vector3
    const startVec = new THREE.Vector3(start[0], start[1], start[2]);
    const endVec   = new THREE.Vector3(end[0], end[1], end[2]);

    points.push(startVec, endVec);

    const geometry = new THREE.BufferGeometry().setFromPoints(points);

	const material = new THREE.LineDashedMaterial({
		color: filterColorByTheme(color, selectedTheme),
		dashSize: 2,
		gapSize: 2,
		transparent: true,  
		opacity: 0.5        
	});

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // Required for dashed lines

    scene.add(line);
    return line;
}

function noneOrbital(cxyz,pxyz = [0,0,0]) {
	add_line([cxyz[0], cxyz[1], 	0]	, [		0	, cxyz[1]	, 	0], 0x772222) ;
	add_line([cxyz[0], cxyz[1], 	0]	, [cxyz[0]	, 	0		,	0], 0x227722) ;
	add_line([cxyz[0], cxyz[1], cxyz[2]], [cxyz[0]	, cxyz[1]	, 	0], 0x222277) ;

	add_line(cxyz, pxyz, 0xcccccc) ;
}

function drawBelt({ innerRadius, outerRadius, center = [0, 0, 0], color = 0xffffff, opacity = 1 }) {
    const segments = 128;


    const inner = innerRadius * scale;
    const outer = outerRadius * scale;

    const geometry = new THREE.RingGeometry(inner, outer, segments);
    const material = new THREE.MeshBasicMaterial({
        color: filterColorByTheme(color,selectedTheme),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: opacity
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Position the belt's center
    mesh.position.set(center[0], center[1], center[2]);

    scene.add(mesh);
}

// helper for createBGsphere() and createPlanetSphere()
function createRingLine(radius, segments = 36) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];

    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        const x = radius * Math.cos(theta);
        const y = radius * Math.sin(theta);
        vertices.push(x, y, 0);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

function createBGsphere() {
    const radius = 550000;
    const segments = 64;
    const color = filterColorByTheme(0x242424, selectedTheme);
    const equatorColor = filterColorByTheme(0x1e1e1e, selectedTheme);

    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
    const equatorMaterial = new THREE.LineBasicMaterial({ color: equatorColor, transparent: true, opacity: 0.5 });

    bgSphere = new THREE.Group();

    // Latitude rings (excluding poles)
    for (let i = 1; i < 18; i++) {
        const lat = (i / 18) * Math.PI - Math.PI / 2;
        const r = Math.cos(lat) * radius;
        const y = Math.sin(lat) * radius;

        const ringGeo = createRingLine(r, segments);
        const ring = new THREE.Line(ringGeo, material);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        bgSphere.add(ring);
    }

    // Equator
    const equatorGeo = createRingLine(radius, segments);
    const equator = new THREE.Line(equatorGeo, equatorMaterial);
    equator.rotation.x = Math.PI / 2;
    bgSphere.add(equator);

    // Longitude rings
    for (let i = 0; i < 36; i++) {
        const ringGeo = createRingLine(radius, segments);
        const ring = new THREE.Line(ringGeo, material);
        ring.rotation.y = Math.PI / 2;
        const group = new THREE.Group();
        group.add(ring);
        group.rotation.y = (i / 36) * 2 * Math.PI;
        bgSphere.add(group);
    }

    bgSphere.rotation.set(Math.PI / 2, 0, 0);
    scene.add(bgSphere)
}

function createPlanetSphere(r = 50, body) {
    const radius = r;
    const latSegments = 18;
    const longSegments = 36;
    const pointsPerLine = 128;

    const color = filterColorByTheme(0x555555, selectedTheme);
    const equatorColor = filterColorByTheme(0xcccccc, selectedTheme);

    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
    const equatorMaterial = new THREE.LineBasicMaterial({ color: equatorColor, transparent: true, opacity: 0.5 });

    const PlSphere = new THREE.Group();

    // --- Latitude rings (skip poles) ---
    for (let i = 1; i < latSegments; i++) {
        const lat = (i / latSegments) * Math.PI - Math.PI / 2; // -π/2 .. π/2
        const rLat = Math.cos(lat) * radius;
        const y = Math.sin(lat) * radius;

        const ringGeo = createRingLine(rLat, pointsPerLine);
        const ring = new THREE.Line(ringGeo, material);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        PlSphere.add(ring);
    }

    // --- Equator ---
    const equatorGeo = createRingLine(radius, pointsPerLine);
    const equator = new THREE.Line(equatorGeo, equatorMaterial);
    equator.rotation.x = Math.PI / 2;
    PlSphere.add(equator);

    // --- Longitude rings (skip poles) ---
    const epsilon = 0.0528; // skip top/bottom 5%
    for (let i = 0; i < longSegments; i++) {
        const points = [];
		for (let j = epsilon; j <= 1 - epsilon; j += 1 / pointsPerLine) {
			const lat = j * Math.PI - Math.PI / 2; // -π/2 .. π/2
			const y = radius * Math.sin(lat);      // vertical position
			const rLat = radius * Math.cos(lat);   // horizontal radius
			points.push(new THREE.Vector3(rLat, y, 0)); // line along X-Y, rotate later
		}

        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, material);

        const group = new THREE.Group();
        group.add(line);
        group.rotation.y = (i / longSegments) * 2 * Math.PI;
        PlSphere.add(group);
    }

    // --- Initial rotation ---
    PlSphere.rotation.set(Math.PI / 2, 0, 0);

    // --- Rotation animation ---
    animateCallbacks.push(() => {
		const offsetRad = body.rotation_offset * Math.PI / 180;
        const rot = offsetRad + get_current_rot(body.rotation_period);
        PlSphere.rotation.set(Math.PI / 2, rot, 0);
    });

    scene.add(PlSphere);
}

function createParentStar(radius, dist, x,y,z,color=0xffffff) {
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
	const material = new THREE.MeshBasicMaterial({ color: filterColorByTheme(color, selectedTheme) }); 
    const localStar = new THREE.Mesh(geometry, material);
	localStar.position.set(x,y,z);   
    scene.add(localStar);
}

// ########### updates group data #############
function getRandomColor() {
  return Math.floor(Math.random() * 0x888888 + 0x777777);
}

let groupMarkers = {};
let playerColors = {}; 
let systemPlayers = {};

const arrowScale = 0.8;  // tweak to make arrows visible
const arrowMinLength = 0.5; // minimum visible length
const arrowMaxLength = 50;  // maximum arrow length

function updateGroupPositions(parent) {
	if (!parent) parent = { X: 0, Y: 0, Z: 0, radius_km: 0, rotation_offset: 0, rotation_period: 1 };

    // Remove disconnected or system-changed players
    for (const id of Object.keys(groupMarkers)) {
        const pos = positions[id];
        if (!pos || (pos.system !== groupMarkers[id].system && selectedSystem !== "")) {
            const m = groupMarkers[id];
            scene.remove(m.marker, m.wireframeSphere, m.arrow);
            if (m.label) m.label.remove();
            delete groupMarkers[id];
            delete playerColors[id];
            retroLog(`Removed marker for ${id}`, document.getElementById('statusContent'));
        }
    }

    for (const [id, pos] of Object.entries(positions)) {
        if (!pos.position || (pos.position.x === 0 && pos.position.y === 0 && pos.position.z === 0)) continue;
        if (selectedSystem !== "" && !selectedSystem.toLowerCase().includes(pos.system.toLowerCase())) continue;

        if (!playerColors[id]) playerColors[id] = getRandomColor();
        const color = playerColors[id];

        const planetPos = new THREE.Vector3(parent.X * 0.001, parent.Y * 0.001, parent.Z * 0.001);
        const playerPos = new THREE.Vector3(pos.position.x, pos.position.y, pos.position.z);
        const PLAYERDISTANCE = planetPos.distanceTo(playerPos); // distance to parent
        const STARDISTANCE = playerPos.length(); // distance to star at 0,0,0

        // Compute positionString
        let positionString;
        if (PLAYERDISTANCE < (parent.radius_km + 200)) {
            // close to parent: show lat/lon + distances
            const offsetRad = parent.rotation_offset * (Math.PI / 180);
            const rot = offsetRad + get_current_rot(parent.rotation_period);
            const rel = playerPos.clone().sub(planetPos).normalize();
            const lat = Math.asin(rel.z) * (180 / Math.PI);
            const lon = (Math.atan2(rel.y, rel.x) - rot) * (180 / Math.PI);
            const lonNorm = ((lon + 540) % 360) - 180;
            positionString = ` lat:${lat.toFixed(2)}° lon:${lonNorm.toFixed(2)}° D:${PLAYERDISTANCE.toFixed(1)}km Ds:${STARDISTANCE.toFixed(1)}km`;
        } else {
            // far: show distances only
            if (Math.abs(PLAYERDISTANCE - STARDISTANCE) < 0.1) { 
				// distances are effectively the same
				positionString = ` D:${PLAYERDISTANCE.toFixed(1)}km`;
			} else {
				positionString = ` D:${PLAYERDISTANCE.toFixed(1)}km Ds:${STARDISTANCE.toFixed(1)}km`;
			}
        }

        // CREATE marker if missing
        if (!groupMarkers[id]) {
            retroLog(`Creating marker for ${id} in system ${pos.system}`, document.getElementById('statusContent'));

            const geoMarker = new THREE.SphereGeometry(0.1, 16, 16);
            const matMarker = new THREE.MeshBasicMaterial({ color: filterColorByTheme(color, selectedTheme) });
            const marker = new THREE.Mesh(geoMarker, matMarker);

			// === Animated Ring Marker ===
			const ringMat = new THREE.LineBasicMaterial({
				color: filterColorByTheme(color, selectedTheme),
				transparent: true,
				opacity: 0.8
			});

			// Helper to create flat circle (no center vertex)
			function createRing(radius = 0.8, segments = 48) {
				const geo = new THREE.CircleGeometry(radius, segments);
				const pos = geo.attributes.position;
				const newPositions = [];
				for (let i = 3; i < pos.count * 3; i++) { // skip center vertex
					newPositions.push(pos.array[i]);
				}
				const ringGeo = new THREE.BufferGeometry();
				ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
				return new THREE.LineLoop(ringGeo, ringMat);
			}

			// Build rings
			const ring1 = createRing(0.1, 32); // static top
			const ring2 = createRing(0.1, 32); // static bottom
			const ring3 = createRing(0.35, 32); // oscillating

			// Flat horizontal rings in XY plane
			ring1.rotation.z = Math.PI / 2;
			ring2.rotation.z = Math.PI / 2;
			ring3.rotation.z = Math.PI / 2;

			// Position static rings along Z
			const ringOffset = 0.35;
			ring1.position.z = ringOffset;   // top
			ring2.position.z = -ringOffset;  // bottom

			// Mark oscillating ring
			ring3.userData.oscillate = true;

			const ringGroup = new THREE.Group();
			ringGroup.add(ring1, ring2, ring3);
			scene.add(ringGroup);

            const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0xff0000);

            scene.add(marker, ringGroup, arrow);

            // Label offset for empty selectedSystem
            let labelOffset = { x: 180, y: -20 };
            if (selectedSystem === "") {
				
                const sysKey = pos.system.toLowerCase();
				console.log('sysKey:', sysKey, systemPlayers);
				
                if (!systemPlayers[sysKey]) systemPlayers[sysKey] = [];
                systemPlayers[sysKey].push(id);
                const index = systemPlayers[sysKey].length - 1;
                labelOffset.y = (index - (systemPlayers[sysKey].length - 1) / 2) * 22;
            }
			
            const label = createLabel({
                attachTo: marker,
                name: id + positionString,
                theme: selectedTheme,
                offset: labelOffset,
                hoverInfo: `X:${pos.position.x.toFixed(1)}km Y:${pos.position.y.toFixed(1)}km Z:${pos.position.z.toFixed(1)}km`,
                clickable: true
            });

			groupMarkers[id] = { 
				marker, 
				wireframeSphere: ringGroup, 
				label, 
				arrow, 
				system: pos.system, 
				labelOffset  // <— add this line
			};

        }

        const m = groupMarkers[id];

        // Compute marker position
        let markerPos;
        if (selectedSystem === "") {
            const sysKey = pos.system.toLowerCase();
            const sysNode = nodeMap[sysKey];
            if (!sysNode) continue;
            markerPos = sysNode.position.clone();
        } else {
            markerPos = new THREE.Vector3(
                (pos.position.x - (parent.X * 0.001)) * scale,
                (pos.position.y - (parent.Y * 0.001)) * scale,
                (pos.position.z - (parent.Z * 0.001)) * scale
            );
        }

        // Update colors
        m.marker.material.color.setHex(filterColorByTheme(color, selectedTheme));

		// Update all ring materials inside the group
		m.wireframeSphere.traverse(obj => {
			if (obj.isLine) {
				obj.material.color.setHex(filterColorByTheme(color, selectedTheme));
			}
		});

        // Update position
        m.targetPos = markerPos.clone();

        // === Label & tooltip update ===
        if (m.label) {
            // Only recreate label if positionString changed
            if (m.lastPositionString !== positionString) {
                m.label.remove();
                m.label = createLabel({
                    attachTo: m.marker,
                    name: id + positionString,
                    theme: selectedTheme,
                    offset: m.labelOffset,
                    hoverInfo: `X:${pos.position.x.toFixed(1)}km Y:${pos.position.y.toFixed(1)}km Z:${pos.position.z.toFixed(1)}km`,
                    clickable: true
                });
                m.lastPositionString = positionString;
            } else {
                // Update tooltip regardless
                const tooltip = m.label.querySelector('.label-tooltip');
                if (tooltip) {
                    tooltip.innerHTML = `X:${pos.position.x.toFixed(1)}km Y:${pos.position.y.toFixed(1)}km Z:${pos.position.z.toFixed(1)}km`;
                }
            }
        }

        // === Compute velocity / arrow ===
        if (!m.lastPos) m.lastPos = markerPos.clone();
        const dt = (Date.now() - (m.lastTime || Date.now())) / 1000;
        const velocity = markerPos.clone().sub(m.lastPos).divideScalar(dt || 1);
        m.lastPos = markerPos.clone();
        m.lastTime = Date.now();

        if (velocity.length() > 1e-3) {
            const dir = velocity.clone().normalize();
            let length = velocity.length() * arrowScale;
            length = Math.max(length, arrowMinLength);
            length = Math.min(length, arrowMaxLength);

            m.arrow.setDirection(dir);
            m.arrow.setLength(length, length * 0.2, length * 0.2);
            m.arrow.position.copy(markerPos);
            m.arrow.visible = true;
        } else {
            m.arrow.visible = false;
        }
    }
}

// Toplevel render helpers 
function makeGlowyStar(color = 0xffffff, size = 6) {
	const texture = new THREE.TextureLoader().load('/static/glow.png'); // use a radial gradient image (white center -> transparent edges)
	const material = new THREE.SpriteMaterial({
		map: texture,
		color,
		transparent: true,
		depthWrite: false
	});
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(size, size, 1.0);
	return sprite;
}

function randomStarColor() {
	// Generate RGB values with:
	// R: 221–255 (dd–ff)
	// G: fixed at 221 (dd)
	// B: 221–255 (dd–ff)
	const r = 219 + Math.floor(Math.random() * (255 - 219 + 1));
	const g = 219;
	const b = 219 + Math.floor(Math.random() * (255 - 219 + 1));

	return (r << 16) | (g << 8) | b;  // Convert to hex color int
}

function renderGalaxybg(n = 2000) {
	const texture = new THREE.TextureLoader().load('/static/glow.png');
	const material = new THREE.SpriteMaterial({
		map: texture,
		color: filterColorByTheme(randomStarColor(), selectedTheme),
		transparent: true,
		depthWrite: false
	});

	for (let i = 0; i < n; i++) {
		const material = new THREE.SpriteMaterial({
			map: texture,
			color: filterColorByTheme(randomStarColor(), selectedTheme),
			transparent: true,
			depthWrite: false
		});
		const sprite = new THREE.Sprite(material);

		// Galaxy swirl math
		const offset = 150;
		const radius = 1 + i * 0.45; 
		const angle = i * 0.15; // spiral curve
		const x = radius * Math.cos(angle) * (1+(Math.random() *0.5 - 0.25));
		const y = offset + radius * Math.sin(angle) * (1+(Math.random() *0.5 - 0.25));
		
		const centerFalloff = 1 - (i / n); // 1 at center, 0 at edge
		const bulgePower = 3; // Exaggerates falloff — tweak this
		const bulge = Math.pow(centerFalloff, bulgePower); // more sharp near center
		const z = (Math.random() - 0.5) * 25 * bulge;
		
		sprite.position.set(x, y, z);
		const size = Math.random() * 0.22 + 4; 
		sprite.scale.set(size, size, 1);
		scene.add(sprite);
	}
}

// Create toplevel starmap from '/system', no orbits just a point cloud with connections
const nodeMap = {};  // systemId -> mesh
function renderSystemGraph(connections) {
	const systems = Object.keys(connections);

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.9); 
	scene.add(ambientLight);
	stopAnimation();
	createBGsphere();
	
	console.log("Loading ", systems.length, " stars");
	
	// Create nodes from position values
	systems.forEach((id) => {
		const data = connections[id];
		const [x, y, z] = data.position.map(v => v * 10);
		
		// Make sphere for node
		const geometry = new THREE.SphereGeometry(0.5, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: filterColorByTheme(0xffffff, selectedTheme) });
		const star = new THREE.Mesh(geometry, material);
		star.position.set(x, y, z);
		scene.add(star);
		const color = filterColorByTheme(0xffffff, selectedTheme);
		const node = makeGlowyStar(color, 8); // slightly larger glow
		node.position.set(x, y, z);
		scene.add(node);
		nodeMap[id] = node;
		
		// Circles based on planet count
		const pcount = data.pcount || 0;
		if (pcount > 0) {
			for (let i = 1; i <= pcount; i++) {
				const radius = 0.8 + i * 0.4; // base radius + spacing per moon
				const circleGeom = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 64);
				const circleMat = new THREE.MeshBasicMaterial({
					color: filterColorByTheme(0x00ffff, selectedTheme), // pick theme color
					side: THREE.DoubleSide
				});
				const circle = new THREE.Mesh(circleGeom, circleMat);
				circle.position.set(x, y, z);
				scene.add(circle);
			}
		}

		createLabel({
			position: node.position,
			name: id,
			fontSize: '16px',
			theme: selectedTheme,
			
			clickable: true,
			offset: { x: 0, y: 0 },
			onClick: () => {
				const origin = selectedSystem; // store the original value				
				onSystemChange(id);
				parent.otherIframeFunction("system_" + selectedSystem);
				console.log(`System: ${selectedSystem}`);
				
				unloadSystem();
				loadSystem(origin);
			},
			attachTo: node
		});
	});

	// Draw connections using 'links'
	console.log("Drawing Connections...");

	const material = new THREE.LineBasicMaterial({ color: filterColorByTheme(0xffffff, selectedTheme) });
	const linePoints = [];
	const drawn = new Set();

	for (const [from, data] of Object.entries(connections)) {
		data.links.forEach(to => {
			const key = [from, to].sort().join('-');
			if (drawn.has(key)) return;
			drawn.add(key);

			const fromNode = nodeMap[from];
			const toNode = nodeMap[to];
			if (fromNode && toNode) {
				linePoints.push(fromNode.position.clone());
				linePoints.push(toNode.position.clone());
			}
		});
	}

	const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
	const lines = new THREE.LineSegments(geometry, material);
	scene.add(lines);

	console.log("Loading ~2000 local galaxy stars");

	renderGalaxybg(700);
	renderGalaxybg(1200);
	
	startTracking();
}

// Create starmap from '/system', just a somewhat flatish point cloud with size=dist
function renderSystemGraphBG(connections) {
    const rootSystemKey = selectedSystem.split("/")[0];   // e.g. "stanton"
    const storageKey = "SysGraphBG_" + rootSystemKey;

    // Try to load from localStorage first
    const savedGraph = localStorage.getItem(storageKey);
	
	if (savedGraph) {
		const graphData = JSON.parse(savedGraph);
		Object.keys(graphData).forEach(id => {
			const pos = graphData[id];

			// Star sphere
			const geometry = new THREE.SphereGeometry(1000, 8, 8);
			const material = new THREE.MeshBasicMaterial({
				color: filterColorByTheme(0xffffff, selectedTheme)
			});
			const star = new THREE.Mesh(geometry, material);
			star.position.set(pos.x, pos.y, pos.z);
			scene.add(star);

			// Glowy node
			const node = makeGlowyStar(filterColorByTheme(0xffffff, selectedTheme), pos.size);
			node.position.set(pos.x, pos.y, pos.z);
			scene.add(node);
			nodeMap[id] = node;

			// Recreate label
			const rootData = connections[selectedSystem.split("/")[0]];
			const rootLinks = rootData ? rootData.links || [] : [];
			const labelName = rootLinks.includes(id) ? `[${id}]` : id;

			createLabel({
				position: node.position,
				name: labelName,
				fontSize: '16px',
				theme: selectedTheme,
				clickable: true,
				offset: { x: 0, y: 0 },
				onClick: () => {
					const origin = selectedSystem;
					onSystemChange(id);
					parent.otherIframeFunction("system_" + selectedSystem);
					console.log(`System: ${selectedSystem}`);
					retroLog(`System: ${selectedSystem}`, document.getElementById('retroContent'));
					unloadSystem();
					loadSystem(origin);
				},
				attachTo: node,
				angle: -45,
				angleDistance: 80,
				rotation: -45
			});
		});

		console.log("Loaded system graph for ", selectedSystem, "from localStorage (with labels)");
		retroLog(`Loaded system graph for ${selectedSystem} from cache`, document.getElementById('retroContent'));
		return;
	}

    // No saved graph → compute normally
    const rootData = connections[rootSystemKey];
    if (!rootData) {
        console.warn("Root system not found in connections");
        return;
    }

    const [rx, ry, rz] = rootData.position.map(v => v * 10);
    const rootLinks = rootData.links || [];
    const radius = 500000;

    const systems = Object.keys(connections)
        .filter(id => id.split("/")[0] !== rootSystemKey);

    console.log("Rendering", systems.length, "stars (excluding", rootSystemKey, ")");
	retroLog(`Rendering ${systems.length} stars (excluding ${rootSystemKey})`, document.getElementById('retroContent'));

    const graphData = {}; // to save positions per star

    systems.forEach(id => {
        const data = connections[id];
        const [ox, oy, oz] = data.position.map(v => v * 10);

        const dir = new THREE.Vector3(ox - rx, oy - ry, (oz - rz) * 2);
        if (dir.length() === 0) return;

		const distance = dir.length(); 
        dir.normalize().multiplyScalar(radius);

        // Star sphere
        const geometry = new THREE.SphereGeometry(1000, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: filterColorByTheme(0xffffff, selectedTheme)
        });
        const star = new THREE.Mesh(geometry, material);
        star.position.copy(dir);
        scene.add(star);

        // Glowy node
        const nodesize = (100 / distance) * 3000;
        const node = makeGlowyStar(filterColorByTheme(0xffffff, selectedTheme), nodesize);
        node.position.copy(dir);
        scene.add(node);
        nodeMap[id] = node;

        // Save position for localStorage
        graphData[id] = {
			x: node.position.x,
			y: node.position.y,
			z: node.position.z,
			size: nodesize
		};

        // Wrap label in brackets if system is a root link
        const labelName = rootLinks.includes(id) ? `[${id}]` : id;

        createLabel({
            position: node.position,
            name: labelName,
            fontSize: '16px',
            theme: selectedTheme,
            clickable: true,
            offset: { x: 0, y: 0 },
            onClick: () => {
                const origin = selectedSystem;
                onSystemChange(id);
                parent.otherIframeFunction("system_" + selectedSystem);
                console.log(`System: ${selectedSystem}`);
                unloadSystem();
                loadSystem(origin);
            },
            attachTo: node,
            angle: -45,
            angleDistance: 80,
            rotation: -45
        });
    });

    // Save to localStorage per root system
    localStorage.setItem(storageKey, JSON.stringify(graphData));
    console.log("Saved system graph for", rootSystemKey, "to localStorage");
}

// ##########################################################################
// COMMS
// Called from parent when the page first loads
function receiveHash(hash) {
    console.log("Got hash from parent:", hash);

    const parts = hash.replace(/^#\/?/, "").split("/");

    unloadSystem();

    if (parts[0] === "system") {
        const systemPath = parts.slice(1).join("/");
        selectedSystem = systemPath;
        console.log("Set selectedSystem from hash:", selectedSystem);

        // ---------------------------
        // Sync dropdown
        // ---------------------------
        const select = document.getElementById("systemSelect");
        if (select) {
            let option = select.querySelector(`option[value="${selectedSystem}"]`);

            if (!option) {
                // Add missing system
                const newOpt = document.createElement("option");
                newOpt.value = selectedSystem;
                newOpt.textContent =
                    selectedSystem.charAt(0).toUpperCase() + selectedSystem.slice(1);
                select.appendChild(newOpt);
            }

            // Select it
            select.value = selectedSystem;
        }

        loadSystem(selectedSystem);
    } else {
        // fallback
        selectedSystem = "stanton";

        // Sync dropdown also for fallback
        const select = document.getElementById("systemSelect");
        if (select) select.value = "stanton";

        loadSystem(selectedSystem);
    }
}


// Whenever user changes system 
function onSystemChange(newSystem) {
    console.log(newSystem);

    selectedSystem = newSystem
        .replace(/\/\//g, "/")   // replace all double slashes
        .replace(/^\/+/, "");    // remove leading slash

    console.log(selectedSystem);

    // Update iframe + hash
    parent.otherIframeFunction("system_" + selectedSystem);
    parent.updateMainHash("#/system/" + selectedSystem);

    // ---- NEW PART: set or add <select> option ----
    const select = document.getElementById("systemSelect");
    let option = select.querySelector(`option[value="${selectedSystem}"]`);

    if (option) {
        // Already exists → select it
        select.value = selectedSystem;
    } else {
        // Does not exist → add it dynamically
        const newOpt = document.createElement("option");
        newOpt.value = selectedSystem;
        newOpt.textContent = selectedSystem.charAt(0).toUpperCase() + selectedSystem.slice(1);
        select.appendChild(newOpt);
        select.value = selectedSystem;
    }
}

// --- reset_terminal: stop typing and clear queue ---
function reset_terminal(targetContent) {
    const q = queues.get(targetContent);
    if (q) {
        // instead of abort/flush, insert a clear marker
        q.queue.unshift({
            message: "[CLS]",
            resolve: () => {
                targetContent.innerHTML = '';
            }
        });
    }
}

// moves it to end of DOM
function bringConsoleToFront() {
    document.body.appendChild(document.getElementById('groupPanel')); 
    document.body.appendChild(document.getElementById('settingsPanel')); 
    document.body.appendChild(document.getElementById('retroConsole'));
    document.body.appendChild(document.getElementById('statusConsole')); 
}

//RETROLOG
// Configuration
const MAX_LINES = 40;
const TYPING_SPEED = 10; // milliseconds per character

// State and queue

let lineCount = 0;
let isTyping = false;

const messageQueue = [];
let currentTypingController = { abort: false };
let processQueuePromise = null; // singleton promise

const queues = new Map(); // target -> { queue: [], processing: false }

// --- retroLog: add message to queue ---
function retroLog(message, target) {
    return new Promise(resolve => {
        if (!queues.has(target)) {
            queues.set(target, { queue: [], processing: false, controller: null, aborted: false });
        }
        const q = queues.get(target);

        // Reset aborted flag for new messages
        q.aborted = false;

        q.queue.push({ message, resolve });

        if (!q.processing) {
            q.processing = true;
            processQueue(target, q).finally(() => {
                q.processing = false;
                q.controller = null;
            });
        }
    });
}
// --- status and updates ---
let lastStatusLines = Array(10).fill(''); // keep track of last lines to avoid duplicates
async function updateStatus() {
    try {
        const res = await fetch(statusUrl + '?_=' + Date.now());
        const data = await res.json();

        for (let i = 0; i < 10; i++) {
            const line = data[`line${i}`] || '';
            if (line && line !== lastStatusLines[i]) {
                lastStatusLines[i] = line;
                // Use existing retroLog function to queue typing
                retroLog(line,document.getElementById('statusContent'));
            }
        }
    } catch (e) {
        retroLog("[STATUS] Fetch error: " + e.message);
    }
}
// --- processQueue: loop through messages ---
async function processQueue(target, q) {
    while (q.queue.length > 0) {
        if (q.aborted) break; // stop immediately if aborted

        const { message, resolve } = q.queue.shift();
        const controller = { abort: false };
        q.controller = controller;
        currentTypingController = controller;

        // Stop if aborted
        if (controller.abort) break;

        await typeMessage(message, controller, target, q);

        if (resolve) resolve();

        if (controller.abort || q.aborted) break;
    }
}
// --- typeMessage: type out characters ---
async function typeMessage(message, controller, target, q) {
    if (!target || q.aborted || controller.abort) return;  // <-- added !target check

	//const existingCursor = (target instanceof Element) ? target.querySelector('.cursor') : null;
	//if (existingCursor) existingCursor.remove();

    // Remove existing cursor
    const existingCursor = target.querySelector('.cursor');
    if (existingCursor) existingCursor.remove();

    if (target.hasChildNodes()) target.appendChild(document.createElement('br'));

    const textSpan = document.createElement('span');
    target.appendChild(textSpan);

    const cursorSpan = document.createElement('span');
    cursorSpan.classList.add('cursor');
    cursorSpan.textContent = '█';
    target.appendChild(cursorSpan);

    for (let char of message) {
        if (controller.abort || q.aborted) break;

        textSpan.textContent += char;
        target.scrollTop = target.scrollHeight;

        await new Promise(r => {
            if (!controller.abort && !q.aborted) setTimeout(r, TYPING_SPEED);
            else r();
        });
    }

    cursorSpan.remove();

    if (!controller.abort && !q.aborted) target.appendChild(document.createElement('br'));

    const children = Array.from(target.childNodes);
    let lineCount = children.length;

    while (lineCount > MAX_LINES) {
        target.removeChild(children[0]);
        children.shift();
        lineCount--;
    }

    target.scrollTop = target.scrollHeight;
}



