import QtQuick 2.15

Rectangle {
    id: root
    property string message: ""

    width: toastText.implicitWidth + 32
    height: 36; radius: 8
    color: "#1e2d4a"
    border.color: "#2d4a7a"
    opacity: 0
    visible: opacity > 0

    Text {
        id: toastText
        anchors.centerIn: parent
        text: root.message
        color: "#e2e8f0"; font.pixelSize: 13
    }

    function show(msg) {
        message = msg
        showAnim.restart()
    }

    SequentialAnimation {
        id: showAnim
        NumberAnimation { target: root; property: "opacity"; to: 1.0; duration: 160; easing.type: Easing.OutQuad }
        PauseAnimation { duration: 2000 }
        NumberAnimation { target: root; property: "opacity"; to: 0.0; duration: 300; easing.type: Easing.InQuad }
    }
}
