import QtQuick 2.15
import QtQuick.Controls 2.15

Item {
    Column {
        anchors.centerIn: parent
        spacing: 16

        Label {
            text: "Aegis Score Studio"
            font.pixelSize: 28
            font.weight: Font.Light
            color: "#e2e8f0"
            anchors.horizontalCenter: parent.horizontalCenter
        }

        Label {
            text: "Paste a YouTube URL or drop an audio file to begin."
            color: "#64748b"
            font.pixelSize: 14
            anchors.horizontalCenter: parent.horizontalCenter
        }
    }
}
