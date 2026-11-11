// Copy remains plain HTML so the author can edit it without JavaScript.
import {applyTheme} from './theme.mjs';
import {mountFigures} from './about-viz.mjs';
applyTheme();
void mountFigures();
const backParams=new URLSearchParams(location.search);backParams.set('restore','1');
document.getElementById('back-map').href=`index.html?${backParams}`;
