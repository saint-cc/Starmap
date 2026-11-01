import os
import json
import sqlite3
from collections import OrderedDict

DB_PATH = 'star_map.db'
DATA_DIR = 'static\data'

# Template in exact desired order and default values
TEMPLATE = OrderedDict([
    ("id", "nameid"),
    ("name", "name"),
    ("type", "planet"),
    ("parent", "stanton"),
    ("X", 0.0),
    ("Y", 0.0),
    ("Z", 0.0),
    ("distance", 0.0),
    ("inc", 0.0),
    ("asc", 0.0),
    ("angle3", 0.0),
    ("radius", 1.0),  
    ("radius_km", 1000.0),
    ("color", "#ffffff"),
    ("rotation_period", 0.0),
    ("rotation_offset", 0.0),
    ("latitude", 0.0),
    ("longitude", 0.0),
    ("locked", "false")
])

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # access columns by name
    return conn

DB_TO_JSON_KEYMAP = {
    "x": "X",
    "y": "Y",
    "z": "Z"
}

def update_item_from_db(cur, item, is_moon_system=False):
    """
    Update item from DB if a row with the same name exists, only if values differ.
    Special case: if is_moon_system and item type is 'parent', don't overwrite type.
    """
    cur.execute("SELECT * FROM bodies WHERE name = ?", (item.get("name"),))
    row = cur.fetchone()
    if row:
        changed = False
        for key in row.keys():
            json_key = DB_TO_JSON_KEYMAP.get(key, key)
            if json_key in item:
                # Special exception: moon system parent
                if is_moon_system and item.get("type") == "parent" and json_key == "type":
                    continue  # preserve the 'parent' type in JSON
                # Only update if value differs
                if item[json_key] != row[key]:
                    item[json_key] = row[key]
                    changed = True
        return changed
    return False


def enforce_template(item):
    """Ensure all keys exist, fill defaults, preserve order, and enforce types"""
    new_item = OrderedDict()
    for key, default in TEMPLATE.items():
        value = item.get(key, default)

        # Type enforcement
        if isinstance(default, float):  # numeric fields
            try:
                value = float(value)
            except (ValueError, TypeError):
                value = default
        elif isinstance(default, int):  # just in case you add int later
            try:
                value = int(value)
            except (ValueError, TypeError):
                value = default
        elif isinstance(default, str):
            # Special case: "false"/"true" string normalization
            if key == "locked":
                if str(value).lower() in ["true", "1"]:
                    value = "true"
                else:
                    value = "false"
            else:
                value = str(value)
        new_item[key] = value

    return new_item


def process_file(file_path, conn):
    with open(file_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f, object_pairs_hook=OrderedDict)
            cur = conn.cursor()
            updated_count = 0

            if not data:
                print(f"ℹ️  Empty JSON in {file_path}")
                return

            top_item = data[0]
            is_moon_system = top_item.get("type") == "moon"

            # Step 0: auto-set parent planet type to "parent" if moon system
            if is_moon_system:
                parent_id = top_item.get("parent")
                if parent_id:
                    for item in data:
                        if item.get("id") == parent_id:
                            # Only change if currently "planet"
                            if item.get("type") == "planet":
                                item["type"] = "parent"
                                updated_count += 1
                            break
                    else:
                        # Optional: parent planet missing, fetch from DB and inject
                        cur.execute("SELECT * FROM bodies WHERE id = ?", (parent_id,))
                        row = cur.fetchone()
                        if row:
                            new_parent = OrderedDict()
                            for key, default in TEMPLATE.items():
                                json_key = key
                                # Map DB x/y/z to JSON X/Y/Z
                                db_key = key.lower() if key in ["X","Y","Z"] else key
                                new_parent[key] = row[db_key] if db_key in row.keys() else default
                            new_parent["type"] = "parent"
                            data.insert(0, new_parent)
                            updated_count += 1

            # Step 1: process all items
            for idx, item in enumerate(data):
                item = enforce_template(item)
                if update_item_from_db(cur, item, is_moon_system=is_moon_system):
                    updated_count += 1
                item = enforce_template(item)
                data[idx] = item

            # Step 2: always write JSON (to enforce type normalization)
            with open(file_path, 'w', encoding='utf-8') as out_f:
                json.dump(data, out_f, indent=2)

            if updated_count > 0:
                print(f"✅ Updated {updated_count} items from DB in {file_path} (types normalized as well)")
            else:
                print(f"ℹ️  No DB updates in {file_path}, but types normalized")

        except Exception as e:
            print(f"❌ Failed {file_path}: {e}")



def process_directory(directory):
    conn = get_db()
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.json'):
                process_file(os.path.join(root, file), conn)
    conn.close()

def find_system_dir(system_name):
    """Find the path to a given system directory inside DATA_DIR."""
    for entry in os.listdir(DATA_DIR):
        entry_path = os.path.join(DATA_DIR, entry)
        if os.path.isdir(entry_path) and entry.lower() == system_name.lower():
            return entry_path
    return None

def update_jsons(parent_path=None):
    """
    Update only the relevant system, including:
      - top-level system JSON (e.g., stanton.json)
      - all JSONs in its folder (e.g., stanton/*)
    """
    print(f"DEBUG: Called update_jsons with parent_path={parent_path}")
    conn = get_db()

    if parent_path:
        system_root = parent_path.split('/')[0]
        print(f"DEBUG: Extracted top-level system: {system_root}")

        # Top-level system JSON
        system_json = os.path.join(DATA_DIR, f"{system_root}.json")
        print(f"DEBUG: Looking for top-level system JSON at {system_json}")
        if os.path.isfile(system_json):
            print(f"🔄 Updating top-level system JSON: {system_json}")
            process_file(system_json, conn)
        else:
            print(f"⚠️ Top-level system JSON not found: {system_json}")

        # Folder with moons/planets
        system_folder = os.path.join(DATA_DIR, system_root)
        print(f"DEBUG: Looking for system folder at {system_folder}")
        if os.path.isdir(system_folder):
            print(f"🔄 Updating all JSONs inside folder: {system_folder}")
            process_directory(system_folder)
        else:
            print(f"⚠️ System folder not found: {system_folder}")

    else:
        print("🔄 Updating all systems....")
        process_directory(DATA_DIR)

    conn.close()
    print("DEBUG: update_jsons finished")


if __name__ == "__main__":
    update_jsons()