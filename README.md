# Camera Gallery Card

A lightweight, swipeable media gallery card for [Home Assistant](https://www.home-assistant.io/) Lovelace.  
Browse `.jpg` snapshots and `.mp4` clips stored on your system — sorted by date, with day-by-day navigation, bulk selection, download, and delete support.

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/49a8f360-185a-4e8d-bd4d-3ae464a2ac1e" width="280" /></td>
    <td><img src="https://github.com/user-attachments/assets/b62eb219-43fc-4238-af55-20d5ddf746ba" width="280" /></td>
  </tr>
</table>

> **Current version:** 1.0.0

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [File Sensor Setup](#file-sensor-setup)
- [Automation Example](#automation-example)
- [Card Configuration](#card-configuration)
- [Delete Setup](#delete-setup)
- [File Naming Convention](#file-naming-convention)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Credits](#credits)
- [Nederlandse versie](#nederlandse-versie)

---

## Features

- 🖼️ Full-width preview with swipe navigation
- 🎬 Inline video playback with auto-generated poster thumbnails
- 📅 Day-by-day filtering with date navigation
- ✅ Bulk select & delete mode
- ⬇️ One-tap download for any file
- 🕒 Configurable timestamp bar (top / bottom / hidden)
- 🔆 Adjustable timestamp bar opacity
- 🎨 Visual editor — no YAML needed
- 📱 Fully responsive, touch-friendly design

---

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant.
2. Go to **Frontend** → click the **⋮** menu → **Custom repositories**.
3. Add this repository URL:  
   `https://github.com/TheScubadiver/camera-gallery-card`
4. Select **Dashboard** as the category and click **Add**.
5. Search for **Camera Gallery Card** and click **Install**.
6. Restart Home Assistant.

### Manual

1. Download `camera-gallery-card.js` and `camera-gallery-card-editor.js` from the latest release.
2. Copy both files to `/config/www/camera-gallery-card/`.
3. Add the resource in **Settings → Dashboards → Resources**:
   - **URL:** `/local/camera-gallery-card/camera-gallery-card.js`
   - **Type:** JavaScript Module
4. Restart Home Assistant.

---

## File Sensor Setup

The card requires a **file sensor** that scans a directory and exposes the file list as an attribute (default: `fileList`).

This is commonly done with the **Files in a Folder** integration:

Repository:  
https://github.com/TarheelGrad1998/files

### Example sensor (generic)

Add the following to your `configuration.yaml`:

```yaml
sensor:
  - platform: files
    folder: /config/www/<your_media_folder>
    name: <your_gallery_sensor_name>
    sort: date
```

**Notes:**

- The `folder` **must be inside** `/config/www/` so Home Assistant can serve the files via `/local/`.
- The created entity will be `sensor.<your_gallery_sensor_name>`.

After creating the sensor, restart Home Assistant and verify in **Developer Tools → States** that the entity has a `fileList` attribute with file paths.

---

## Automation Example

This is just an example to generate files in the correct naming format.  
Replace the entities and folder with your own.

### Snapshot example

```yaml
automation:
  - alias: "Save snapshot on motion (example)"
    trigger:
      - platform: state
        entity_id: <your_motion_entity>
        to: "on"
    action:
      - service: camera.snapshot
        target:
          entity_id: <your_camera_entity>
        data:
          filename: "/config/www/<your_media_folder>/camera{{ now().strftime('%Y%m%d_%H%M%S') }}.jpg"
```

### Video clip example

```yaml
automation:
  - alias: "Save clip on motion (example)"
    trigger:
      - platform: state
        entity_id: <your_motion_entity>
        to: "on"
    action:
      - service: camera.record
        target:
          entity_id: <your_camera_entity>
        data:
          filename: "/config/www/<your_media_folder>/camera{{ now().strftime('%Y%m%d_%H%M%S') }}.mp4"
          duration: 10
```

---

## Card Configuration

```yaml
type: custom:camera-gallery-card
entity: sensor.<your_file_sensor_entity>
delete_service: shell_command.<your_delete_service_name>
preview_height: 320
thumb_size: 140
bar_position: top
bar_opacity: 45
```

---

## Delete Setup

The gallery deletes files by calling a Home Assistant service.  
This service must be defined in your `configuration.yaml`.

### Add a shell command

```yaml
shell_command:
  <your_delete_service_name>: "rm -f '{{ path }}'"
```

Example of what runs:

```
rm -f '/config/www/<your_media_folder>/20250227_143022.mp4'
```

Restart Home Assistant after adding the shell command.

---

### Configure the card

```yaml
delete_service: shell_command.<your_delete_service_name>
```

---

## Important Safety Note

The card only allows deleting files inside:

```
/config/www/
```

⚠️ Files are permanently deleted.  
There is no recycle bin.

---

## File Naming Convention

The card extracts date and time from filenames to enable:

- Day filtering
- Timestamp display
- Correct sorting

Required format inside filename:

```
YYYYMMDD_HHMMSS
```

Supported:

```
YYYYMMDD-HHMMSS.jpg
YYYYMMDD_HHMMSS.mp4
```

Example:

```
20250227_143022.jpg
```

Interpreted as:

- Date: 2025-02-27  
- Time: 14:30:22  

If the pattern is missing:

- The file will still display
- Date filtering and timestamps may not work

---

## Troubleshooting

**Card not showing**

- Verify the resource is added correctly
- Hard refresh your browser

**No media found**

- Verify the file sensor entity exists
- Confirm the `fileList` attribute contains file paths
- Confirm files are stored under `/config/www/`

**Delete not working**

- Verify your service exists in Developer Tools → Services
- Confirm the files are under `/config/www/`
- Check Home Assistant logs for permission issues

---

## License

MIT © [TheScubadiver](https://github.com/TheScubadiver)

---

## Credits

Created by **TheScubaDiver**.

Forks are welcome, but attribution is required under the MIT License.  
Please keep the LICENSE file and this credits section intact.

---

# Nederlandse versie

## Camera Gallery Card

Een lichte, swipebare mediagalerij-kaart voor [Home Assistant](https://www.home-assistant.io/) Lovelace.  
Blader door `.jpg` snapshots en `.mp4` videoclips die lokaal op je systeem zijn opgeslagen — gesorteerd op datum, met navigatie per dag, bulkselectie, downloaden en verwijderen.

## Functionaliteiten

- 🖼️ Volledige previewbreedte met swipe-navigatie  
- 🎬 Inline video-afspelen met automatisch gegenereerde thumbnails  
- 📅 Filteren per dag met datum-navigatie  
- ✅ Bulk selecteren & verwijderen  
- ⬇️ Bestanden downloaden met één tik  
- 🕒 Instelbare tijdsbalk (boven / onder / verborgen)  
- 🔆 Instelbare transparantie van de tijdsbalk  
- 🎨 Visuele editor — geen YAML nodig  
- 📱 Volledig responsive en touch-vriendelijk  

## Installatie

Volg dezelfde stappen als hierboven bij **Installation**.

## Bestandssensor instellen

Zie **File Sensor Setup** hierboven.

## Verwijderinstellingen

Zie **Delete Setup** hierboven.

## Bestandsnaamconventie

Zie **File Naming Convention** hierboven.
