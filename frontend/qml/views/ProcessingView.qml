import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Item {
    property real progress: 0.0

    readonly property var stages: [
        "Fetch & decode audio",
        "Source separation (Demucs)",
        "Instrument identification",
        "MIDI transcription",
        "Notation engraving",
    ]

    Column {
        anchors.centerIn: parent
        spacing: 24
        width: 420

        Label {
            text: "Analyzing…"
            font.pixelSize: 22
            font.weight: Font.Medium
            color: "#e2e8f0"
            anchors.horizontalCenter: parent.horizontalCenter
        }

        // Progress bar
        Rectangle {
            width: parent.width
            height: 6
            radius: 3
            color: "#1e2535"
            Rectangle {
                width: parent.width * progress
                height: parent.height
                radius: 3
                color: "#60a5fa"
                Behavior on width { SmoothedAnimation { duration: 300 } }
            }
        }

        Label {
            text: Math.round(progress * 100) + "%"
            color: "#94a3b8"
            anchors.horizontalCenter: parent.horizontalCenter
        }

        // Stage list
        Repeater {
            model: stages
            Row {
                spacing: 10
                Rectangle {
                    width: 8; height: 8; radius: 4
                    color: index < Math.round(progress * 5) ? "#34d399" : "#334155"
                    anchors.verticalCenter: parent.verticalCenter
                }
                Label {
                    text: modelData
                    color: index < Math.round(progress * 5) ? "#e2e8f0" : "#64748b"
                    font.pixelSize: 13
                }
            }
        }
    }
}
