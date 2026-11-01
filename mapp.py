from flask import Flask, request, render_template, jsonify, send_from_directory, abort
import logging
import ipaddress
import os
import time
import math
from datetime import datetime, UTC
import re
import json
import sqlite3
import update_jsons_fromDB

# Store the last valid reading (fallback)


app = Flask(__name__)

DATA_DIR = 'static/data'

DB_PATH = 'star_map.db'

logging.basicConfig(
    filename="access.log",
    level=logging.INFO,
    format="%(message)s"
)

@app.after_request
def log_request_info(response):
    log_data = {
        "time": datetime.now(UTC).isoformat(),  
        "ip": request.headers.get("X-Forwarded-For", request.remote_addr),
        "host": request.headers.get("Host"),
        "port": 80,
        "method": request.method,
        "path": request.path,
        "user_agent": request.user_agent.string,
        "code": response.status_code
    }
    try:
        app.logger.info(json.dumps(log_data, ensure_ascii=False))
    except Exception as e:
        app.logger.error(f"Logging failed: {e}")
    return response

def get_db():
    return sqlite3.connect(DB_PATH)
    
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/map')
def map():
    return send_from_directory('static', 'map.html')

@app.route('/edit')
def edit():
    return send_from_directory('static', 'edit.html')

@app.route('/treeview')
def tools():
    return send_from_directory('static', 'treeview.html')

@app.route('/system')
def dataroot():
    with open('static/system.json') as f1:
        links = json.load(f1)

    with open('static/system_coords.json') as f2:
        positions = json.load(f2)

    with open('static/system_pcount.json') as f3:
        pcounts = {entry["name"]: entry["pcount"] for entry in json.load(f3)}

    # Combine the data into a single dict
    combined = {}
    for name in links:
        combined[name] = {
            "links": links[name],
            "position": positions.get(name),
            "pcount": pcounts.get(name, 0)  # default 0 if missing
        }

    return jsonify(combined)

def normalize_fields(data):
    # Normalize keys to lowercase
    data = {k.lower(): v for k, v in data.items()}

    # Default values for all expected fields, now including latitude, longitude, rotation_offset
    defaults = {
        "id": "",
        "name": "",
        "type": "unknown",
        "parent": "",
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "distance": 0.0,
        "inc": 0.0,
        "asc": 0.0,
        "angle3": 0.0,
        "radius": 0.0,
        "radius_km": 0.0,
        "color": "#ffffff",
        "rotation_period": 0,
        "rotation_offset": 0.0,
        "latitude": 0.0,
        "longitude": 0.0,
        "locked": "false",
        "measured": 0,
        "source": "inputOM"
    }

    # Merge defaults with provided data
    for key, default_val in defaults.items():
        if key not in data or data[key] is None:
            data[key] = default_val

    # Convert numeric fields to float/int safely
    float_fields = ["x", "y", "z", "distance", "inc", "asc", "angle3",
                    "radius", "radius_km", "rotation_period", "rotation_offset",
                    "latitude", "longitude"]
    for field in float_fields:
        try:
            data[field] = float(data[field])
        except (ValueError, TypeError):
            data[field] = 0.0

    return data


# Define your internal network(s), e.g., local LAN 192.168.0.0/16 or 10.0.0.0/8
ALLOWED_NETWORKS = [
    ipaddress.ip_network("127.0.0.1/32"),      # localhost
    ipaddress.ip_network("192.168.0.0/16"),    # typical LAN
    ipaddress.ip_network("172.16.0.0/16"),     # alternative LAN
    #ipaddress.ip_network("141.8.86.110/32"),     # <-- Malta
]

def is_internal_ip(ip):
    try:
        client_ip = ipaddress.ip_address(ip)
        return any(client_ip in net for net in ALLOWED_NETWORKS)
    except ValueError:
        return False  # invalid IP

@app.route('/inputOMData', methods=['POST'])
def input_om_data():
    client_ip = request.remote_addr
    if not is_internal_ip(client_ip):
        abort(403)  # forbidden

    data = request.get_json()
    data = normalize_fields(data)
    print("📨 Received full data object:", data)
    
    # load STARMAP once at start (or reload periodically)
    with open('./STARMAP.JSON', 'r', encoding='utf-8') as f:
        downloaded_map = json.load(f)

    # inside input_om_data(), after normalize_fields(data)
    # lowercase for lookup
    data_name_lower = data["name"].lower()

    # find matching entry in downloaded JSON
    match = next((item for item in downloaded_map
                  if item.get("ObjectContainer", "").lower() == data_name_lower), None)

    if match:
        # update id from InternalName
        data["id"] = match.get("InternalName", data["id"])
        
        # update rotation
        rot_speed_x = match.get("RotationSpeedX")
        if rot_speed_x is not None:
            data["rotation_period"] = float(rot_speed_x) * 3600  # hours -> seconds

        # update coordinates if allowed
        if data["type"].lower() != "star" and (data["x"] == 0 and data["y"] == 0 and data["z"] == 0):
            data["x"] = float(match.get("XCoord", data["x"]))
            data["y"] = float(match.get("YCoord", data["y"]))
            data["z"] = float(match.get("ZCoord", data["z"]))

    required = ["id", "name", "type", "parent", "x", "y", "z"]
    if not all(field in data for field in required):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    def safe(val, default):
        return val if val is not None else default

    try:
        conn = get_db()
        cur = conn.cursor()

        # Load parent X,Y,Z if needed
        parent_full = data["parent"]
        parent_name = parent_full.split('/')[-1]  
        parent_x, parent_y, parent_z = 0.0, 0.0, 0.0
        if parent_name:
            cur.execute("SELECT x, y, z FROM bodies WHERE name = ?", (parent_name,))
            row = cur.fetchone()
            if row:
                parent_x, parent_y, parent_z = row

        # Coordinates
        x = float(safe(data.get("x"), 0))
        y = float(safe(data.get("y"), 0))
        z = float(safe(data.get("z"), 0))
        
        print(x)
        print(y)
        print(z)

        # Calculate distance from parent if x,y not zero
        distance = float(safe(data.get("distance"), 0))
        if (x != 0 or y != 0 or z != 0):
            dx, dy, dz = x - parent_x, y - parent_y, z - parent_z
            distance = (math.sqrt(dx*dx + dy*dy + dz*dz) ) * 0.001

        # Calculate angle3 in parent XY plane
        angle3 = float(safe(data.get("angle3"), 0))
        if (x != 0 or y != 0):
            dx, dy = x - parent_x, y - parent_y
            angle3 = math.degrees(math.atan2(dy, dx)) % 360

        lat = float(safe(data.get("latitude"), 0))
        lon = float(safe(data.get("longitude"), 0))
        # Latitude & Longitude (for objects on sphere, relative to their own center)
        if (data["type"]=='city'):
            if (x != 0 or y != 0 or z != 0):
                # relative to parent for now
                dx, dy, dz = x - parent_x, y - parent_y, z - parent_z
                r = math.sqrt(dx*dx + dy*dy + dz*dz)
                if r > 0:
                    lat = math.degrees(math.asin(dz / r))  # -90 .. 90
                    lon = math.degrees(math.atan2(dy, dx)) % 360

        now = datetime.now(UTC).isoformat()

        # Insert/update row
        cur.execute('''
            INSERT INTO bodies (
                id, name, type, parent,
                x, y, z, distance, inc, asc, angle3,
                radius, radius_km, color, rotation_period,
                rotation_offset, latitude, longitude,
                locked, measured, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                id=excluded.id,
                type=excluded.type,
                parent=excluded.parent,
                x=excluded.x,
                y=excluded.y,
                z=excluded.z,
                distance=excluded.distance,
                inc=excluded.inc,
                asc=excluded.asc,
                angle3=excluded.angle3,
                radius=excluded.radius,
                radius_km=excluded.radius_km,
                color=excluded.color,
                rotation_period=excluded.rotation_period,
                rotation_offset=excluded.rotation_offset,
                latitude=excluded.latitude,
                longitude=excluded.longitude,
                locked=excluded.locked,
                measured=excluded.measured,
                source=excluded.source,
                updated_at=excluded.updated_at
        ''', (
            data["id"],
            data["name"],
            data["type"],
            data["parent"],
            x,
            y,
            z,
            distance,
            float(safe(data.get("inc"), 0)),
            float(safe(data.get("asc"), 0)),
            angle3,
            float(safe(data.get("radius"), 0)),
            float(safe(data.get("radius_km"), 0)),
            data.get("color", "#ffffff"),
            int(safe(data.get("rotation_period"), 0)),
            float(safe(data.get("rotation_offset"), 0)),
            lat,
            lon,
            str(data.get("locked", "false")),
            int(safe(data.get("measured"), 0)),
            data.get("source", "inputOM"),
            now
        ))

        conn.commit()
        conn.close()
        print(f"✅ Stored/Updated: {data['name']} in {data['parent']}")
        update_jsons_fromDB.update_jsons(data['parent'])
        print(f"✅ Stored/Updated all json files")
        return jsonify({"status": "ok", "message": "Data saved"}), 200

    except Exception as e:
        print(f"❌ DB insert failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500



#everything else under /system
def register_json_routes(base_dir=DATA_DIR, url_prefix='/system'):
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.json'):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, base_dir)
                rel_path = rel_path.replace("\\", "/")  # Normalize Windows paths

                # Handle _map.json as /name/map
                if rel_path.endswith('_map.json'):
                    base_name = rel_path[:-9]  # Remove '_map.json'
                    url_path = f"{url_prefix}/{base_name}/map"
                else:
                    url_path = f"{url_prefix}/" + rel_path.replace(".json", "")

                def handler_func(full_path=full_path):
                    dir_path = os.path.dirname(full_path)
                    filename = os.path.basename(full_path)
                    print(dir_path, filename)
                    return send_from_directory(dir_path, filename)

                print(f"Registering route: {url_path} -> {full_path}")
                app.add_url_rule(url_path, endpoint=url_path, view_func=handler_func)
register_json_routes()



     
if __name__ == '__main__':
   app.run(host='0.0.0.0', port=5000, debug=False)
