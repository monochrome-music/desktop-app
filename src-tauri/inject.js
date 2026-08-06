console.log("[monochrome RPC] injected");

let lastMedia = null;

function sendRPC() {

    const media = navigator.mediaSession?.metadata;

    const audio = document.querySelector("audio");


    if (!media || !audio) {
        return;
    }

    if (!window.updateDiscordRPC) {
        return;
    }

    window.updateDiscordRPC({
        title: media.title || "Unknown Song",
        artist: media.artist || "Unknown Artist",
        album: media.album || "",
        artwork:
            media.artwork?.[0]?.src || "",

        position:
            audio.currentTime || 0,

        duration:
            audio.duration || 0,

        playing:
            !audio.paused
    });

}

setInterval(() => {

    sendRPC();

}, 1000);

setInterval(() => {

    const media =
        navigator.mediaSession?.metadata;
    if(media){

        console.log(
            "[RPC]",
            media.title,
            media.artist
        );

    }

},2000);