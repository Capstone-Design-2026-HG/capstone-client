// A separate shadow root keeps site CSS from changing the extension controls.
(() => {
  if (document.getElementById('search-rating-toolbar')) return;
  const host = document.createElement('div');
  host.id = 'search-rating-toolbar';
  host.style.cssText = 'position:fixed;right:16px;top:30%;z-index:2147483647';
  const root = host.attachShadow({mode:'closed'});
  root.innerHTML = `<style>
    :host{all:initial} *{box-sizing:border-box} .shell{font:13px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;color:#18243a}
    button,select,textarea{font:inherit} button{cursor:pointer} .toggle{border:0;border-radius:10px;background:#1e3a6b;color:white;padding:10px 12px;box-shadow:0 3px 14px #0003}
    .panel{width:290px;background:white;border:1px solid #d9e0ea;border-radius:12px;padding:14px;box-shadow:0 6px 30px #0003}
    .head{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px;cursor:move;touch-action:none;user-select:none}.toggle{touch-action:none}.close{background:none;border:0;font-size:19px}
    .tabs{display:flex;gap:6px;margin:12px 0}.tabs button{flex:1;border:1px solid #d5ddea;background:#f4f6fa;border-radius:7px;padding:7px;color:#263951}.tabs button.active{background:#1e3a6b;color:#fff}
    label{display:block;margin:10px 0 4px;font-weight:600} select,textarea{width:100%;border:1px solid #d3dce8;border-radius:7px;padding:7px;background:white;color:#18243a}
    textarea{resize:vertical}.capture{width:100%;padding:8px;border:1px solid #bdcbe0;background:#f2f6fc;border-radius:7px;color:#1e3a6b}.save{width:100%;padding:9px;border:0;background:#2459ae;color:white;border-radius:7px;margin-top:12px;font-weight:700}.save:disabled{opacity:.5;cursor:wait}
    .small{font-size:11px;color:#60738c;margin:5px 0}.previewWrap{display:flex;align-items:flex-start;gap:6px;margin-top:6px}.previewScroll{flex:1;min-width:0;max-height:160px;overflow:auto;border:1px solid #e1e6ed}.preview{width:100%;height:auto;display:block}.remove{width:24px;height:24px;flex:none;border:1px solid #d3dce8;border-radius:6px;background:white;color:#344c70;font-size:17px;line-height:20px;padding:0}.status{font-size:12px;margin-top:8px;color:#344c70;white-space:pre-wrap} [hidden]{display:none!important}
    .captureOptions{display:flex;gap:4px}.captureOptions button{flex:1;font-size:11px;padding:7px 2px}.overlay{position:fixed;inset:0;z-index:2147483647;background:#0004;cursor:crosshair;touch-action:none}.box{position:fixed;border:2px solid #4d8fff;background:#ffffff33;pointer-events:none}.hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#1e3a6b;color:white;padding:8px 14px;border-radius:8px;pointer-events:none}
  </style><div class="shell"><button class="toggle">자료 저장</button><div class="panel" hidden>
    <div class="head"><span>자료 저장</span><button class="close" aria-label="접기">×</button></div>
    <div class="tabs"><button class="notion active">Notion</button><button class="figma">Figma</button></div>
    <button class="capture connectNotion" hidden>Notion 연결하기</button>
    <label>저장할 페이지</label><select class="destination"><option>목록 불러오는 중…</option></select>
    <div class="textArea"><label>선택한 본문</label><textarea class="selection" rows="3" maxlength="20000" placeholder="페이지에서 텍스트를 드래그해 선택하세요"></textarea><div class="small">선택한 내용은 입력란의 커서 위치에 추가됩니다.</div></div>
    <label>화면 캡처</label><div class="captureOptions"><button class="capture">현재 화면</button><button class="capture region">영역 선택</button><button class="capture full">전체 페이지</button></div><div class="small">영역 선택은 드래그, 취소는 Esc</div><div class="previewWrap" hidden><div class="previewScroll"><img class="preview" alt="캡처 미리보기"></div><button class="remove" aria-label="캡처 삭제" title="캡처 삭제">×</button></div>
    <label>코멘트 (선택)</label><textarea class="comment" rows="2" maxlength="2000" placeholder="저장할 이유나 의견"></textarea>
    <button class="save">저장하기</button><div class="status" role="status"></div>
  </div></div>`;
  document.documentElement.appendChild(host);
  const $ = <T extends Element>(s:string) => root.querySelector(s) as T;
  const toggle=$<HTMLButtonElement>('.toggle'), panel=$<HTMLDivElement>('.panel'), select=$<HTMLSelectElement>('.destination');
  const selection=$<HTMLTextAreaElement>('.selection'), comment=$<HTMLTextAreaElement>('.comment');
  const preview=$<HTMLImageElement>('.preview'), remove=$<HTMLButtonElement>('.remove'), status=$<HTMLDivElement>('.status');
  const previewWrap=$<HTMLDivElement>('.previewWrap');
  const save=$<HTMLButtonElement>('.save'), notion=$<HTMLButtonElement>('.notion'), figma=$<HTMLButtonElement>('.figma');
  let mode:'notion'|'figma'='notion', imageBase64='', selectedText='', captureKind:'screen'|'region'|'full'='screen';
  let port = chrome.runtime.connect({name:'capstone-toolbar'}), nextId=0;
  const pending=new Map<number,{resolve:(value:any)=>void;timer:ReturnType<typeof setTimeout>}>();
  function setupPort(p:chrome.runtime.Port) {
    p.onMessage.addListener((msg:{id:number;data:unknown})=>{const item=pending.get(msg.id); if(item){clearTimeout(item.timer);pending.delete(msg.id);item.resolve(msg.data)}});
    p.onDisconnect.addListener(()=>{for(const item of pending.values()){clearTimeout(item.timer);item.resolve({success:false,message:'확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해 주세요.'})} pending.clear()});
  }
  setupPort(port);
  function call(message:Record<string,unknown>):Promise<any>{return new Promise(resolve=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);resolve({success:false,message:'요청 시간이 초과됐습니다. 다시 시도해 주세요.'})},message.type==='CONNECT_NOTION'?300000:90000);pending.set(id,{resolve,timer});try{port.postMessage({id,...message})}catch{clearTimeout(timer);pending.delete(id);resolve({success:false,message:'페이지를 새로고침해 주세요.'})}})}
  function message(text:string){status.textContent=text}
  let insertStart=0,insertEnd=0;
  function rememberCaret(){insertStart=selection.selectionStart;insertEnd=selection.selectionEnd}
  selection.addEventListener('select',rememberCaret);
  selection.addEventListener('click',rememberCaret);
  selection.addEventListener('keyup',rememberCaret);
  selection.addEventListener('input',()=>{selectedText=selection.value;rememberCaret()});
  function addPageSelection(){
    if(document.activeElement===host)return;
    const pageSelection=window.getSelection();
    if(!pageSelection||[pageSelection.anchorNode,pageSelection.focusNode].some(node=>node===host||(node&&host.contains(node))))return;
    const text=pageSelection.toString().trim();if(!text)return;
    const before=selection.value.slice(0,insertStart),after=selection.value.slice(insertEnd);
    const added=text.slice(0,Math.max(0,20000-before.length-after.length));
    selection.value=before+added+after;selectedText=selection.value;insertStart=insertEnd=before.length+added.length;
    selection.setSelectionRange(insertStart,insertEnd);
    if(added.length<text.length)message('본문은 최대 20,000자까지 저장할 수 있습니다.');
  }
  let pagePointer:{x:number;y:number;before:string}|null=null;
  document.addEventListener('pointerdown',e=>{pagePointer=e.button===0&&!e.composedPath().includes(host)?{x:e.clientX,y:e.clientY,before:window.getSelection()?.toString()||''}:null},true);
  document.addEventListener('pointerup',e=>{const start=pagePointer;pagePointer=null;if(!start||e.composedPath().includes(host))return;const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y)>=3;setTimeout(()=>{if(moved||(window.getSelection()?.toString()||'')!==start.before)addPageSelection()},0)},true);
  document.addEventListener('keyup',e=>{if(!e.composedPath().includes(host)&&(e.key==='Shift'||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a')))addPageSelection()},true);
  let targets:Array<{id:string; label:string;fileKey?:string}>=[];
  let loadVersion=0, connecting=false;
  const connectButton=$<HTMLButtonElement>('.connectNotion');
  async function connect(){
    if(connecting)return;connecting=true;connectButton.disabled=true;connectButton.textContent='Notion 연결 중…';message('Notion 인증 창에서 연결할 페이지를 선택해 주세요.');
    const res=await call({type:'CONNECT_NOTION'});connecting=false;connectButton.disabled=false;connectButton.textContent='Notion 연결하기';
    if(mode!=='notion')return;
    if(res?.success){connectButton.hidden=true;await load();}
    else {connectButton.hidden=false;message(res?.message||res?.error||'Notion 연결에 실패했습니다. 다시 시도해 주세요.')}
  }
  connectButton.onclick=()=>void connect();
  async function load(autoConnect=false){
    const version=++loadVersion; targets=[];
    select.replaceChildren(new Option('불러오는 중…',''));select.disabled=true;connectButton.hidden=true;message('');
    if(mode==='notion'){
      const conn=await call({type:'GET_NOTION_CONNECTION'});if(version!==loadVersion)return;
      if(!conn?.success){message(conn?.message||conn?.error||'Notion 연결 상태를 확인하지 못했습니다.')}
      else if(!conn.data?.connected){connectButton.hidden=false;message('Notion을 연결하면 자료를 저장할 페이지를 선택할 수 있습니다.');if(autoConnect)void connect()}
      else {const res=await call({type:'GET_NOTION_PAGES'});if(version!==loadVersion)return;targets=res?.success?(res.data as Array<{id:string;title:string}>).map(p=>({id:p.id,label:p.title})):[];if(!res?.success){if(['NOTION_NOT_CONNECTED','NOTION_UNAUTHORIZED'].includes(res?.code)){connectButton.hidden=false;message('Notion 연결이 만료되었습니다. 다시 연결해 주세요.');if(autoConnect)void connect()}else message(res?.message||res?.error||'페이지 목록을 불러오지 못했습니다.')}}
    } else {
      const conn=await call({type:'GET_FIGMA_CONNECTION'});if(version!==loadVersion)return;if(!conn?.success||!conn.data?.connected){message('확장 프로그램 설정에서 Figma를 연결해 주세요.');targets=[]}
      else {const stored=await chrome.storage.local.get('figmaFiles');if(version!==loadVersion)return;const files=stored.figmaFiles as Array<{fileKey:string;fileName:string}>|undefined;if(!files?.length){targets=[];message('확장 프로그램 설정에서 Figma 파일을 추가해 주세요.')}
        else {const res=await call({type:'GET_FIGMA_PAGES',files});if(version!==loadVersion)return;targets=res?.success?(res.data as Array<{fileKey:string;fileName:string;pages:Array<{id:string;name:string}>}>).flatMap(f=>f.pages.map(p=>({id:p.id,label:`${f.fileName} / ${p.name}`,fileKey:f.fileKey}))):[];if(!res?.success)message(res?.message||res?.error||'Figma 페이지 목록을 불러오지 못했습니다.')}
      }
    }
    select.replaceChildren();if(!targets.length)select.add(new Option('선택할 페이지가 없습니다',''));else targets.forEach((p,i)=>select.add(new Option(p.label,String(i))));select.disabled=!targets.length;
  }
  let suppressToggleClick=false;
  function makeDraggable(handle:HTMLElement){
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0||(e.target instanceof Element&&e.target.closest('.close')))return;
      const bounds=host.getBoundingClientRect(),startX=e.clientX,startY=e.clientY;let moved=false;
      handle.setPointerCapture(e.pointerId);
      const move=(event:PointerEvent)=>{const dx=event.clientX-startX,dy=event.clientY-startY;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;const current=host.getBoundingClientRect();host.style.left=`${Math.max(0,Math.min(window.innerWidth-current.width,bounds.left+dx))}px`;host.style.top=`${Math.max(0,Math.min(window.innerHeight-current.height,bounds.top+dy))}px`;host.style.right='auto'};
      const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);if(moved&&handle===toggle){suppressToggleClick=true;setTimeout(()=>{suppressToggleClick=false},0)}};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    });
  }
  makeDraggable($<HTMLElement>('.head'));makeDraggable(toggle);
  toggle.onclick=()=>{if(suppressToggleClick)return;toggle.hidden=true;panel.hidden=false;const rect=host.getBoundingClientRect();if(rect.right>window.innerWidth){host.style.left=`${Math.max(0,window.innerWidth-rect.width)}px`;host.style.right='auto'}if(rect.bottom>window.innerHeight)host.style.top=`${Math.max(0,window.innerHeight-rect.height)}px`;void load(mode==='notion')};
  $<HTMLButtonElement>('.close').onclick=()=>{loadVersion++;panel.hidden=true;toggle.hidden=false};
  function changeMode(m:'notion'|'figma'){mode=m;notion.classList.toggle('active',m==='notion');figma.classList.toggle('active',m==='figma');$<HTMLDivElement>('.textArea').hidden=m==='figma';void load(m==='notion')}
  notion.onclick=()=>changeMode('notion');figma.onclick=()=>changeMode('figma');
  type Rect={x:number;y:number;width:number;height:number};
  function chooseRegion():Promise<Rect|null>{return new Promise(resolve=>{
    const overlay=document.createElement('div');overlay.className='overlay';overlay.tabIndex=0;
    overlay.innerHTML='<div class="hint">캡처할 영역을 드래그하세요 · Esc 취소</div><div class="box" hidden></div>';root.appendChild(overlay);overlay.focus();
    const box=overlay.querySelector('.box') as HTMLDivElement;let start:{x:number;y:number}|null=null;
    const finish=(value:Rect|null)=>{overlay.remove();resolve(value)};
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(null)}});
    overlay.addEventListener('pointerdown',e=>{e.preventDefault();start={x:e.clientX,y:e.clientY};overlay.setPointerCapture(e.pointerId);box.hidden=false});
    overlay.addEventListener('pointermove',e=>{if(!start)return;Object.assign(box.style,{left:`${Math.min(start.x,e.clientX)}px`,top:`${Math.min(start.y,e.clientY)}px`,width:`${Math.abs(start.x-e.clientX)}px`,height:`${Math.abs(start.y-e.clientY)}px`})});
    overlay.addEventListener('pointerup',e=>{if(!start)return;const rect={x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(start.x-e.clientX),height:Math.abs(start.y-e.clientY)};finish(rect.width>=4&&rect.height>=4?rect:null)});
    overlay.addEventListener('pointercancel',()=>finish(null));
  })}
  async function prepareImage(base64:string, rect?:Rect):Promise<string>{
    const img=new Image();img.src=`data:image/png;base64,${base64}`;await img.decode();
    const sx=rect?rect.x*img.naturalWidth/window.innerWidth:0, sy=rect?rect.y*img.naturalHeight/window.innerHeight:0;
    const sw=rect?rect.width*img.naturalWidth/window.innerWidth:img.naturalWidth, sh=rect?rect.height*img.naturalHeight/window.innerHeight:img.naturalHeight;
    let scale=Math.min(1, 1600/sw, Math.sqrt(24_000_000/(sw*sh)), 16000/sh);
    for(let i=0;i<5;i++){
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(sw*scale));canvas.height=Math.max(1,Math.floor(sh*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지를 처리할 수 없습니다.');ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL('image/png').split(',')[1];if(result.length<=6_600_000)return result;scale*=0.75;
    }
    throw new Error('캡처 이미지가 너무 큽니다. 더 작은 영역을 선택해 주세요.');
  }
  async function capture(kind:'screen'|'region'|'full'){
    let rect:Rect|null=null;if(kind==='region'){rect=await chooseRegion();if(!rect){message('영역 선택을 취소했습니다.');return}}
    const captureButtons=[...root.querySelectorAll<HTMLButtonElement>('.captureOptions button')];captureButtons.forEach(button=>{button.disabled=true});
    message(kind==='full'?'새 탭에서 전체 페이지 캡처 중…':'캡처 중…');if(kind!=='full')host.style.visibility='hidden';
    try{
      await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
      if(kind==='full'){const res=await call({type:'CAPTURE_FULL_IN_NEW_TAB'});if(!res?.success)throw new Error(res?.message||res?.error||'전체 페이지를 캡처하지 못했습니다.');imageBase64=await prepareImage(res.data.imageBase64)}
      else {const res=await call({type:'CAPTURE_CURRENT_PAGE'});if(!res?.success)throw new Error(res?.message||res?.error||'캡처하지 못했습니다.');imageBase64=await prepareImage(res.data.imageBase64,rect||undefined)}
      captureKind=kind;preview.src=`data:image/png;base64,${imageBase64}`;previewWrap.hidden=false;
      message(kind==='full'?'전체 페이지를 캡처했습니다. Notion에서는 접힌 이미지로 저장됩니다.':kind==='region'?'선택한 영역을 캡처했습니다.':'현재 화면을 캡처했습니다.');
    }catch(e){message(e instanceof Error?e.message:'캡처하지 못했습니다.')}finally{host.style.visibility='visible';captureButtons.forEach(button=>{button.disabled=false})}
  }
  $<HTMLButtonElement>('.captureOptions .capture').onclick=()=>void capture('screen');
  $<HTMLButtonElement>('.region').onclick=()=>void capture('region');
  $<HTMLButtonElement>('.full').onclick=()=>void capture('full');
  remove.onclick=()=>{imageBase64='';preview.removeAttribute('src');previewWrap.hidden=true;message('캡처를 삭제했습니다.')};
  save.onclick=async()=>{
    const target=select.disabled||select.value===''?undefined:targets[Number(select.value)];if(!target){message('저장할 페이지를 선택해 주세요.');return}
    if(mode==='figma'&&!imageBase64){message('먼저 현재 화면을 캡처해 주세요.');return}
    if(mode==='notion'&&!selectedText.trim()&&!imageBase64){message('본문을 선택하거나 화면을 캡처해 주세요.');return}
    save.disabled=true;message('저장 중…');const common={title:document.title,url:location.href,comment:comment.value.trim()};
    const result=mode==='notion'?await call({type:'SAVE_TO_NOTION',...common,pageId:target.id,selectedText:selectedText.trim(),imageBase64,captureKind}):await call({type:'SAVE_CURRENT_TO_FIGMA',...common,fileKey:target.fileKey,pageNodeId:target.id,imageBase64});
    save.disabled=false;if(!result?.success){message(result?.message||result?.error||'저장에 실패했습니다.');return}
    message(mode==='figma'?'Figma에 전송했습니다. Figma 플러그인에서 가져오기를 확인해 주세요.':(result.data?.warning||'Notion에 저장했습니다.')); 
  };
})();
