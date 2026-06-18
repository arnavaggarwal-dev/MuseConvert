import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Rectangle {
    id: root
    property var    job: null
    property string sessionId: ""
    signal exportMidi()
    signal exportWav()
    color: "#090d18"

    Column {
        anchors { top: parent.top; left: parent.left; right: parent.right; topMargin: 0 }
        spacing: 0

        // Header
        Rectangle {
            width: parent.width; height: 36; color: "#0d1220"
            Text { anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                   text: "INSPECTOR"; color: "#334155"; font.pixelSize: 10; font.letterSpacing: 1.5 }
        }

        // Song info
        Rectangle {
            width: parent.width
            height: infoCol.implicitHeight + 24
            color: "transparent"
            Column {
                id: infoCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 6
                Text { text: job ? job.meta.title  : "No project"; color: "#e2e8f0"; font.pixelSize: 15; font.weight: Font.Medium; wrapMode: Text.WordWrap; width: parent.width }
                Text { text: job ? job.meta.artist : "";            color: "#64748b"; font.pixelSize: 12 }
                Text { text: job ? job.meta.sepModel : "";          color: "#334155"; font.pixelSize: 10 }
            }
        }

        Rectangle { width: parent.width; height: 1; color: "#131c2e" }

        // Metrics
        Rectangle {
            width: parent.width; height: metricsCol.implicitHeight + 20; color: "transparent"
            Column {
                id: metricsCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 10
                _MetricRow { label: "Tempo";   value: job ? job.meta.tempo + " BPM" : "—" }
                _MetricRow { label: "Key";     value: job ? job.meta.key : "—" }
                _MetricRow { label: "Time";    value: job ? (job.meta.timeSig ? job.meta.timeSig[0]+"/"+job.meta.timeSig[1] : "4/4") : "—" }
                _MetricRow { label: "Duration";value: job ? _fmtTime(job.meta.duration) : "—" }
                _MetricRow { label: "Stems";   value: job ? job.stems.length : "0" }
                _MetricRow { label: "MIDI";    value: job ? job.stems.reduce(function(a,s){return a+s.midi},0).toLocaleString() : "0" }
            }
        }

        Rectangle { width: parent.width; height: 1; color: "#131c2e" }

        // GPU
        Rectangle {
            width: parent.width; height: gpuCol.implicitHeight + 20; color: "transparent"
            Column {
                id: gpuCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 10
                Text { text: "GPU / CPU"; color: "#475569"; font.pixelSize: 10; font.letterSpacing: 1 }
                Text { text: job ? job.meta.gpu.model : "—"; color: "#94a3b8"; font.pixelSize: 12 }
                // VRAM bar
                Rectangle {
                    width: parent.width; height: 4; radius: 2; color: "#1e2535"
                    visible: job && job.meta.gpu.vramTotal > 0
                    Rectangle {
                        width: job ? (job.meta.gpu.vramTotal > 0 ? parent.width * job.meta.gpu.vram / job.meta.gpu.vramTotal : 0) : 0
                        height: parent.height; radius: 2; color: "#3b82f6"
                    }
                }
                Text { text: job && job.meta.gpu.vramTotal > 0 ? job.meta.gpu.vram.toFixed(1) + " / " + job.meta.gpu.vramTotal.toFixed(1) + " GB" : "CPU-only"; color: "#64748b"; font.pixelSize: 10 }
            }
        }

        Rectangle { width: parent.width; height: 1; color: "#131c2e" }

        // Per-stem confidence
        Rectangle {
            width: parent.width
            height: stemConfCol.implicitHeight + 20
            color: "transparent"
            visible: job !== null
            Column {
                id: stemConfCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 8
                Text { text: "CONFIDENCE"; color: "#475569"; font.pixelSize: 10; font.letterSpacing: 1 }
                Repeater {
                    model: job ? job.stems : []
                    Column {
                        width: parent.width; spacing: 3
                        Row {
                            width: parent.width
                            Text { text: modelData.name; color: "#94a3b8"; font.pixelSize: 11; width: parent.width * 0.5 }
                            Text {
                                text: modelData.confidence.toFixed(1) + "%"
                                color: modelData.confidence>=90?"#34d399":modelData.confidence>=78?"#fbbf24":"#f87171"
                                font.pixelSize: 11; width: parent.width*0.5; horizontalAlignment: Text.AlignRight
                            }
                        }
                        Rectangle {
                            width: parent.width; height: 3; radius: 2; color: "#1e2535"
                            Rectangle {
                                width: parent.width * modelData.confidence / 100
                                height: parent.height; radius: 2
                                color: modelData.confidence>=90?"#34d399":modelData.confidence>=78?"#fbbf24":"#f87171"
                            }
                        }
                    }
                }
            }
        }

        Rectangle { width: parent.width; height: 1; color: "#131c2e" }

        // Export
        Rectangle {
            width: parent.width
            height: exportCol.implicitHeight + 20
            color: "transparent"
            Column {
                id: exportCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 10

                Text { text: "EXPORT"; color: "#475569"; font.pixelSize: 10; font.letterSpacing: 1 }

                _ExportBtn { label: "MIDI stems (.mid)"; icon: "♩"; enabled: job !== null && sessionId !== ""; onClicked: root.exportMidi() }
                _ExportBtn { label: "Audio stems (.wav)"; icon: "🔊"; enabled: job !== null && sessionId !== ""; onClicked: root.exportWav() }
            }
        }
    }

    function _fmtTime(sec) {
        const m = Math.floor(sec/60), s = Math.floor(sec%60)
        return m + ":" + ("0"+s).slice(-2)
    }

    // ── Sub-components ────────────────────────────────────────────────────
    component _MetricRow: Row {
        property string label: ""
        property string value: ""
        width: parent.width; spacing: 0
        Text { text: label; color: "#475569"; font.pixelSize: 11; width: parent.width * 0.45 }
        Text { text: value; color: "#94a3b8"; font.pixelSize: 11; width: parent.width * 0.55; horizontalAlignment: Text.AlignRight }
    }

    component _ExportBtn: Rectangle {
        property string label: ""
        property string icon:  ""
        property bool   enabled: true
        signal clicked()
        width: parent.width; height: 34; radius: 6
        color: btnMouse.containsMouse ? "#1e2d4a" : "#131c2e"
        border.color: "#2d3a52"
        opacity: enabled ? 1.0 : 0.4
        MouseArea { id: btnMouse; anchors.fill: parent; hoverEnabled: true; onClicked: if (parent.enabled) parent.clicked() }
        Row {
            anchors.centerIn: parent; spacing: 8
            Text { text: icon;        color: "#60a5fa"; font.pixelSize: 13 }
            Text { text: label;       color: "#cbd5e1"; font.pixelSize: 12 }
        }
    }
}
