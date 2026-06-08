import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Rectangle {
    property var    job: null
    property string sessionId: ""
    color: "#0d1220"

    Column {
        anchors { top: parent.top; left: parent.left; right: parent.right; topMargin: 52; leftMargin: 12; rightMargin: 12 }
        spacing: 16

        // Song meta
        Label { text: job ? job.meta.title  : "—"; color: "#e2e8f0"; font.pixelSize: 14; font.weight: Font.Medium; wrapMode: Text.WordWrap; width: parent.width }
        Label { text: job ? job.meta.artist : "—"; color: "#64748b"; font.pixelSize: 12 }

        Rectangle { width: parent.width; height: 1; color: "#1e2535" }

        // GPU info
        Label { text: "GPU / CPU"; color: "#475569"; font.pixelSize: 10; font.letterSpacing: 1 }
        Label { text: job ? (job.meta.gpu.model + " · " + job.meta.gpu.util + "%") : "—"; color: "#94a3b8"; font.pixelSize: 12 }

        Rectangle { width: parent.width; height: 1; color: "#1e2535" }

        // Export
        Label { text: "EXPORT"; color: "#475569"; font.pixelSize: 10; font.letterSpacing: 1 }

        Column {
            width: parent.width
            spacing: 8

            Button {
                width: parent.width
                text: "Download stems (WAV)"
                enabled: job !== null && sessionId !== ""
                onClicked: {
                    if (!job) return
                    job.stems.forEach(function(s) {
                        if (s.audio_url) Qt.openUrlExternally("http://127.0.0.1:7471" + s.audio_url)
                    })
                }
            }

            Button {
                width: parent.width
                text: "Download MIDI"
                enabled: job !== null && sessionId !== ""
                onClicked: {
                    if (!job) return
                    job.stems.forEach(function(s) {
                        if (s.midi_url) Qt.openUrlExternally("http://127.0.0.1:7471" + s.midi_url)
                    })
                }
            }
        }
    }
}
