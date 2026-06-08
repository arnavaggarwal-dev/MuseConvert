import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "../components"

Item {
    id: root
    property var    job: null
    property string sessionId: ""

    readonly property var stems:  job ? (job.stems || []) : []
    readonly property int tempo:  job ? (job.meta.tempo || 120) : 120
    readonly property var timeSig: job ? (job.meta.timeSig || [4,4]) : [4,4]
    readonly property int bars:   8

    // Load MIDI notes from backend for each stem when job arrives
    onJobChanged: {
        if (!job || !sessionId) return
        for (let i = 0; i < stems.length; i++) {
            const s = stems[i]
            if (s.midi_url && s.clef !== "perc") {
                const xhr = new XMLHttpRequest()
                xhr.open("GET", "http://127.0.0.1:7471/api/midi/" + sessionId + "/" + s.id)
                xhr.onreadystatechange = (function(stemObj) {
                    return function() {
                        if (xhr.readyState === 4 && xhr.status === 200) {
                            const d = JSON.parse(xhr.responseText)
                            stemObj.midiNotes = d.notes || []
                            staffRepeater.itemAt(stems.indexOf(stemObj))?.reload()
                        }
                    }
                })(s)
                xhr.send()
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // ── Transport bar ──────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 44
            color: "#0d1220"

            Row {
                anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                spacing: 12

                // Play/pause
                Rectangle {
                    width: 32; height: 32; radius: 6
                    color: playBtn.containsMouse ? "#1e2d4a" : "#141c2e"
                    border.color: "#2d3a52"
                    MouseArea { id: playBtn; anchors.fill: parent; hoverEnabled: true }
                    Text { anchors.centerIn: parent; text: "▶"; color: "#60a5fa"; font.pixelSize: 14 }
                }

                // Timecode
                Rectangle {
                    height: 32; width: 120; radius: 6
                    color: "#0a0f1a"
                    border.color: "#1e2535"
                    Text { anchors.centerIn: parent; text: "001 : 1 : 00"; color: "#60a5fa"; font.family: "monospace"; font.pixelSize: 13 }
                }

                // Tempo
                Text { text: tempo + " BPM"; color: "#94a3b8"; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
                Text { text: timeSig[0]+"/"+timeSig[1]; color: "#64748b"; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
                Text { text: job ? job.meta.key : ""; color: "#64748b"; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
            }

            // Right: stem count
            Text {
                anchors { verticalCenter: parent.verticalCenter; right: parent.right; rightMargin: 16 }
                text: stems.length + " stems · " + (stems.reduce((a,s)=>a+s.midi,0)).toLocaleString() + " MIDI events"
                color: "#475569"; font.pixelSize: 12
            }
        }

        Rectangle { Layout.fillWidth: true; height: 1; color: "#1e2535" }

        // ── Score body ─────────────────────────────────────────────────────
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            ScrollBar.horizontal.policy: ScrollBar.AsNeeded
            ScrollBar.vertical.policy: ScrollBar.AsNeeded

            Column {
                width: implicitWidth
                spacing: 0

                // Song title header
                Rectangle {
                    width: Math.max(parent.width, 600)
                    height: 56
                    color: "#0b0f1a"
                    Column {
                        anchors { left: parent.left; leftMargin: 72; verticalCenter: parent.verticalCenter }
                        spacing: 3
                        Text { text: job ? job.meta.title  : ""; color: "#e2e8f0"; font.pixelSize: 18; font.weight: Font.Light }
                        Text { text: job ? (job.meta.artist + " · " + job.meta.key + " · ♩ = " + tempo) : ""; color: "#64748b"; font.pixelSize: 12 }
                    }
                }

                // Staff rows
                Repeater {
                    id: staffRepeater
                    model: stems

                    Rectangle {
                        id: staffRow
                        width: Math.max(staffCanvas.implicitWidth + 68 + 8, 600)
                        height: 90
                        color: index % 2 === 0 ? "#0f1117" : "#0b0e17"

                        // Left label
                        Item {
                            id: labelCol
                            width: 68
                            height: parent.height

                            Column {
                                anchors { right: parent.right; rightMargin: 8; verticalCenter: parent.verticalCenter }
                                spacing: 3

                                Text {
                                    text: modelData.name
                                    color: "#cbd5e1"; font.pixelSize: 11; font.weight: Font.Medium
                                    horizontalAlignment: Text.AlignRight
                                    width: 60; elide: Text.ElideRight
                                }
                                Text {
                                    text: Math.round(modelData.confidence) + "%"
                                    color: modelData.confidence >= 90 ? "#34d399" : modelData.confidence >= 78 ? "#fbbf24" : "#f87171"
                                    font.pixelSize: 10
                                    horizontalAlignment: Text.AlignRight
                                    width: 60
                                }
                            }
                        }

                        // Staff canvas
                        StaffCanvas {
                            id: staffCanvas
                            x: 68
                            y: 0
                            height: parent.height
                            stemData:  modelData
                            tempo:     root.tempo
                            timeSig:   root.timeSig
                            bars:      root.bars
                            stemColor: _stemColor(modelData.color)

                            function reload() { requestPaint() }
                        }

                        // Stem color bar
                        Rectangle {
                            x: 64; y: 16; width: 3; height: 58; radius: 2
                            color: _stemColor(modelData.color)
                        }
                    }
                }

                // Bottom padding
                Item { height: 40; width: parent.width }
            }
        }
    }

    function _stemColor(cssVar) {
        const map = {
            "--s-drums":  "#f97316",
            "--s-bass":   "#a855f7",
            "--s-guitar": "#22c55e",
            "--s-keys":   "#3b82f6",
            "--s-vocal":  "#ec4899",
            "--s-synth":  "#06b6d4",
            "--s-strings":"#84cc16",
            "--s-brass":  "#eab308",
            "--s-wood":   "#14b8a6",
            "--s-perc":   "#f59e0b",
        }
        return map[cssVar] || "#60a5fa"
    }
}
