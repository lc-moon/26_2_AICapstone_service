// Copy remains plain HTML so the author can edit it without JavaScript.
document.getElementById('back-map').href=`index.html${location.search}`;
const image=document.getElementById('comparison-image');
function reveal(){if(image.naturalWidth){image.hidden=false;document.getElementById('comparison-placeholder').hidden=true;}}
image.addEventListener('load',reveal);
reveal();
