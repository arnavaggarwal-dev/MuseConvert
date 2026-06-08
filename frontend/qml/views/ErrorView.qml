import QtQuick 2.15
import QtQuick.Controls 2.15

Item {
    property string message: ""
    Column {
        anchors.centerIn: parent
        spacing: 16
        Label { text: "Analysis failed"; color: "#f87171"; font.pixelSize: 18; anchors.horizontalCenter: parent.horizontalCenter }
        Label { text: message; color: "#94a3b8"; font.pixelSize: 13; anchors.horizontalCenter: parent.horizontalCenter; wrapMode: Text.WordWrap; width: 400 }
        Button { text: "Retry"; anchors.horizontalCenter: parent.horizontalCenter }
    }
}
