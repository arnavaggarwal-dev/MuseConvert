import QtQuick 2.15
import QtQuick.Controls 2.15

Rectangle {
    property var job: null
    color: "#0b0f1a"

    Column {
        anchors { top: parent.top; left: parent.left; right: parent.right; topMargin: 52 }
        spacing: 0

        Label {
            text: "STEMS"
            color: "#475569"
            font.pixelSize: 10
            font.letterSpacing: 1.5
            leftPadding: 16
            topPadding: 12
            bottomPadding: 8
        }

        Repeater {
            model: job ? job.stems : []
            Rectangle {
                width: parent.width; height: 44
                color: "transparent"
                Row {
                    anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                    spacing: 10
                    Rectangle { width: 8; height: 8; radius: 2; color: "#60a5fa"; anchors.verticalCenter: parent.verticalCenter }
                    Column {
                        spacing: 2
                        Label { text: modelData.name; color: "#e2e8f0"; font.pixelSize: 12 }
                        Label { text: Math.round(modelData.confidence) + "% · " + modelData.midi + " notes"; color: "#64748b"; font.pixelSize: 10 }
                    }
                }
            }
        }
    }
}
