import {installDisposableDialog} from '../dialog-lifecycle.js';
import {mountActivityView} from './activity-view.js';
import {mountQuietView} from './quiet-view.js';
import {allChatsAllowed} from '../chat-access.js';
import {modelChoiceLabel,modelId,modelLabel} from './model-catalog-data.js';
import {createSearchSources} from './search-sources.js';
import {mountPersonaLibrary} from './persona-library.js';
import {createConditionalMotion} from './conditional-motion.js';
import {mountSendSettings,mountCompactSettings,PROACTIVE_SETTING_HELP} from './send-settings.js';

// Presentation only: move the selected settings controls, never clone their
// values, save handlers, credential state or transaction controllers.
export const SETTINGS_SECTIONS = [
  ['models','模型 API'], ['search','搜索服务'], ['memory','记忆'],
  ['persona','人设'], ['access','聊天白名单'], ['chat','聊天设置'],
  ['desktop','桌面端'], ['onebot','OneBot'], ['tools','工具与技能'],
];
export const canonicalSettingsSection = id => ({api:'models',allow:'access',wake:'chat',send:'chat',active:'chat',security:'chat',prices:'models',uikit:'desktop'}[id] || id);

export function composeSettingsStructure({sections,host,read,write,request,save,reload,activityDraft,commitActivity,getProviders=()=>[],onActivityChange=()=>{},onIdle=()=>{},onEditorClosed=()=>{},doc=host.ownerDocument}) {
  let disposed=false;
  const editors=new Map(),refreshers=[],restorers=[],disposers=[];
  const visibility=createConditionalMotion(doc);disposers.push(visibility.dispose);
  const fieldsByPath=new Map();
  for(const el of host.querySelectorAll('.setting-field[data-path]'))if(!fieldsByPath.has(el.dataset.path))fieldsByPath.set(el.dataset.path,el);
  const watch=(keys,run)=>{run.keys=keys;refreshers.push(run);};
  const node=(tag,cls,value)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;};
  const action=(label,run)=>{const el=node('button','',label);el.type='button';el.addEventListener('click',run);return el;};
  const field=path=>fieldsByPath.get(path);
  const group=(id,label)=>[...sections.get(id).card.querySelectorAll('[data-settings-label]')].find(el=>el.dataset.settingsLabel===label);
  const content=id=>{const entry=sections.get(id);entry.card.hidden=false;entry.card.classList.remove('card','settings-section');entry.card.classList.add('settings-subsection');entry.card.querySelector(':scope > .module-head').hidden=true;return entry.card;};
  function fold(parent,id,title,children,open=false){
    const box=node('details','settings-fold'),summary=node('summary','settings-fold-title',title),body=node('div','settings-fold-body');
    box.dataset.collapsible='';box.dataset.settingsGroup=`layout-${id}`;box.open=open;
    body.append(...children.filter(Boolean));box.append(summary,body);parent.append(box);return body;
  }
  function root(id,title,description){
    const card=node('article','card settings-section'),head=node('div','module-head'),text=node('div','module-text'),fields=node('div','settings-fields');
    card.id=`section-${id}`;text.append(node('h3','',title),node('p','muted',description));head.append(text);card.append(head,fields);
    return {card,fields,title,description,meta:head};
  }
  // Nodes outside #fields (persistent reset bindings / prompt preview) go back
  // before the next render clears the old layout.
  function borrow(el){if(!el)return null;const anchor=doc.createComment('settings structure');el.before(anchor);restorers.push(()=>anchor.replaceWith(el));return el;}
  function modal(parent,id,title,children,{summary,description='普通设置自动保存；关闭后仍保留当前输入。'}={}){
    const box=node('div','settings-launcher'),open=action(title,()=>show()),detail=node('p','muted'),parking=node('div','settings-editor-parking');
    parking.hidden=true;parking.append(...children.filter(Boolean));open.dataset.settingsOpen=id;open.setAttribute('aria-haspopup','dialog');
    box.append(open,detail,parking);parent.append(box);
    let life=null,dialog=null;
    const refresh=()=>{detail.textContent=summary?.()||'';detail.hidden=!detail.textContent;};refreshers.push(refresh);
    function show(){
      if(disposed)return;if(life&&!life.closed){dialog.focus();return;}
      const focus=doc.activeElement;dialog=node('dialog','settings-layout-dialog');dialog.dataset.settingsEditor=id;
      dialog.setAttribute('aria-labelledby',`settings-editor-${id}`);
      const head=node('div','settings-dialog-head'),heading=node('h3','',title),close=action('关闭',()=>life.close());heading.id=`settings-editor-${id}`;
      head.append(heading,close);const body=node('div','settings-dialog-body');body.append(...parking.childNodes);
      dialog.append(head,node('p','muted settings-dialog-note',description),body);
      const status=doc.querySelector('#status'),feedback=node('p','muted settings-dialog-status'),footer=node('div','settings-dialog-footer');feedback.setAttribute('role','status');
      const syncStatus=()=>{feedback.textContent=status?.textContent||'';feedback.classList.toggle('field-error',status?.classList.contains('field-error')===true);};
      const observer=new doc.defaultView.MutationObserver(syncStatus);if(status)observer.observe(status,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});syncStatus();
      footer.append(feedback);
      if(reload&&id!=='prompt-preview'){
        const reread=action('重新读取',async()=>{reread.disabled=true;try{await reload();}catch(error){feedback.textContent=error.message;feedback.classList.add('field-error');}finally{reread.disabled=false;}});reread.dataset.settingsReload='';footer.append(reread);
      }
      if(save&&body.querySelector('[data-config-path]')){
        const commit=action('保存改动',async()=>{commit.disabled=true;try{await save();}catch(error){feedback.textContent=error.message;feedback.classList.add('field-error');}finally{commit.disabled=false;}});commit.dataset.settingsSave='';footer.append(commit);
      }
      dialog.append(footer);
      life=installDisposableDialog(dialog,{dismissOnBackdrop:true,onClosed:()=>{
        observer.disconnect();
        for(const input of body.querySelectorAll('[data-manager-key]')){input.type='password';input.value='';}
        for(const toggle of body.querySelectorAll('[data-manager-key-toggle]'))toggle.textContent='显示';
        parking.append(...body.childNodes);life=null;dialog=null;refresh();onEditorClosed(id);
        if(focus?.isConnected&&!doc.querySelector('dialog:modal'))focus.focus({preventScroll:true});
        if(!disposed&&!doc.querySelector('dialog[data-settings-editor][open]'))onIdle();
      }});
      doc.body.append(dialog);dialog.showModal();
    }
    const close=()=>{
      if(!dialog)return;
      // A render can also retire a parent while a nested picker is open.
      const stack=[...doc.querySelectorAll('dialog:modal')],index=stack.indexOf(dialog);
      if(index>=0)for(const nested of stack.slice(index+1).reverse())nested.close();
      life?.close();
    };
    editors.set(id,{show,close,box,parking,get open(){return !!dialog?.open;}});return editors.get(id);
  }
  function conditional(el,visible){el.dataset.settingsConditional='';visibility.set(el,visible);}
  const nav=new Map(SETTINGS_SECTIONS.map(([id,title])=>{
    const entry=sections.get(id)||root(id,title,id==='chat'?'发送、响应、活跃与表情。常用项内联，低频项展开编辑。':'协议地址、目录与连接凭据。');
    entry.title=title;entry.card.querySelector('h3').textContent=title;
    return [id,entry];
  }));
  for(const [id,description] of [
    ['models','选择模型与渠道；配置、目录和成本按需打开。'],
    ['memory','后台整理、专用模型与自动发现阈值。'],
    ['access','选择允许响应的群聊和好友，或在选择窗口允许全部。'],
    ['desktop','桌面行为、界面、数据管理与版本更新。'],
  ]){const entry=nav.get(id);entry.description=description;entry.card.querySelector('.module-text p').textContent=description;}

  // 模型 API: configuration and catalog each have one entrance.
  const models=nav.get('models'),endpoint=group('models','接入点'),sampling=group('models','采样与预算'),thinking=group('models','思考模式'),media=group('models','多模态输入');
  const fallback=field('api.fallbackModels'),modelActions=models.card.querySelector(':scope > .actions');
  const buttons=[...modelActions.children],take=label=>buttons.find(el=>el.textContent===label);
  const config=node('div','model-config-layout'),main=node('div','model-config-main'),identity=node('p','muted model-config-identity'),inputs=node('div','model-media-inputs'),state=node('div','model-config-state');
  const mainPick=take('从目录选择主模型'),test=take('测试主模型');mainPick.setAttribute('aria-label','从目录选择主模型');mainPick.classList.add('model-config-picker');test.setAttribute('aria-label','测试主模型');test.textContent='测试连通性';main.append(mainPick,test);
  // Keep the existing form controls as hidden state; the compact view writes
  // through the same FormState rather than maintaining another configuration.
  state.hidden=true;state.append(...['api.baseUrl','api.provider','api.model','api.vision','api.video','api.visionModel','api.videoModel','api.visionProvider','api.videoProvider','skills.video-frames.enabled'].map(field),endpoint.querySelector('.main-credential'),fallback,field('api.modelPrices'));
  for(const[kind,label]of [['vision','图片输入'],['video','视频输入']]){
    const row=node('div','model-media-row'),toggle=action(label,()=>write(`api.${kind}`,read(`api.${kind}`)!==true)),pick=[...media.querySelectorAll('button')].find(el=>el.textContent===`选择${kind==='vision'?'图片':'视频'}模型`),slide=node('div','model-media-slide');
    row.dataset.modelMedia=kind;toggle.className='model-media-toggle';toggle.setAttribute('role','switch');pick.className='model-media-pick';pick.setAttribute('aria-label',`选择${kind==='vision'?'图片':'视频'}模型`);slide.dataset.motion='off';slide.append(pick);row.append(toggle,slide);inputs.append(row);
    watch([`api.${kind}`,`api.${kind}Model`,`api.${kind}Provider`,'api.provider','api.model'],()=>{
      const enabled=read(`api.${kind}`)===true,model=read(`api.${kind}Model`)||read('api.model'),provider=read(`api.${kind}Provider`)||read('api.provider');toggle.setAttribute('aria-checked',String(enabled));conditional(slide,enabled);pick.disabled=!enabled;pick.textContent=modelChoiceLabel(getProviders(),{provider,model});pick.title=pick.textContent;
    });
  }
  const videoMode=field('api.videoMode');
  config.append(node('h4','','模型目录（点击选择）'),main,identity,models.card.querySelector('#api-test-result'),inputs,videoMode,state);
  watch(['api.video'],()=>conditional(videoMode,read('api.video')===true));
  const updateConfig=()=>{const provider=read('api.provider'),model=read('api.model');const label=[...doc.querySelectorAll('.model-catalog-item')].find(item=>item.dataset.providerId===provider&&item.dataset.modelId===model)?.querySelector('.model-catalog-name')?.textContent;mainPick.textContent=label||model||'点击选择模型';identity.textContent=`模型ID：${model||'未选择'}，BaseURL：${read('api.baseUrl')||'未配置'}`;};
  watch(['api.provider','api.model','api.baseUrl'],updateConfig);
  const modelConfig=modal(models.fields,'model-config','模型配置',[config],{});
  endpoint.remove();media.remove();
  const providerLayout=models.card.querySelector('#provider-manager-layout');
  const add=modal(providerLayout.querySelector('#provider-manager-actions'),'provider-add','添加渠道',[models.card.querySelector(':scope > .settings-editor')],{description:'填写渠道名称、Base URL 和 API Key，点击“添加渠道”。'});
  add.box.classList.add('provider-add-launcher');
  const modelManager=modal(models.fields,'model-manager','模型管理',[providerLayout],{description:'左侧选择渠道，右侧管理模型；添加、修改和删除各自保存。'});
  const modelEntries=node('div','settings-model-entries');modelEntries.append(modelConfig.box,modelManager.box);
  const modelCard=fold(models.fields,'models','模型与渠道',[modelEntries],true);models.fields.prepend(modelCard.parentElement);
  fold(models.fields,'fallback','备选模型（故障自动降级）',[take('管理备选模型')]);
  modelActions.remove();
  fold(models.fields,'prices','成本核算',[content('prices')]);

  // Keep the original fields once; the selected source editor commits through
  // the same settings transaction and custom-source controller.
  const search=nav.get('search'),sources=group('search','各源接口与密钥（高级）'),sourceFields=[...sources.querySelector(':scope > .settings-fields').children];
  const searchState=node('div','search-enabled-state'),searchProvider=field('webSearch.provider'),searchLimit=field('webSearch.maxResults');
  const searchToggle=action('启用联网搜索',()=>write('webSearch.enabled',read('webSearch.enabled')!==true));
  searchToggle.className='search-enabled-toggle';searchToggle.setAttribute('role','switch');searchToggle.setAttribute('aria-controls','search-service-options');searchLimit.id='search-max-results-option';
  searchState.hidden=true;searchState.append(field('webSearch.enabled'),searchProvider,field('webSearch.searchUrl'),...sourceFields,search.card.querySelector('#search-provider-list'),search.card.querySelector(':scope > .settings-editor'));
  const searchSources=createSearchSources({read,commit:commitActivity,save,request,doc,onDraftChange:onActivityChange}),searchRow=node('div','search-service-row full'),searchOptions=node('div','search-service-options full');
  searchOptions.id='search-service-options';searchOptions.dataset.motion='off';searchOptions.append(searchSources.choice,searchLimit);
  searchRow.append(searchToggle,searchSources.manage);search.fields.replaceChildren(searchRow,searchOptions,searchState);sources.remove();disposers.push(searchSources.dispose);
  watch(['webSearch'],searchSources.refresh);
  watch(['webSearch.enabled'],()=>{const enabled=read('webSearch.enabled')===true;searchToggle.setAttribute('aria-checked',String(enabled));conditional(searchOptions,enabled);});

  // Memory retains its short common path; advanced thresholds stay collapsed.
  const memory=nav.get('memory'),memoryModel=node('div','memory-model-choice'),consolidate=group('memory','记忆整理');
  const memoryFields=consolidate.querySelector(':scope > .settings-fields'),memoryState=node('div','memory-consolidate-state'),memoryRow=node('div','memory-consolidate-row full'),cooldown=node('div','memory-consolidate-cooldown');
  const memoryToggle=action('自动定期记忆整理',()=>write('memory.consolidateEnabled',read('memory.consolidateEnabled')!==true));
  memoryToggle.className='memory-consolidate-toggle';memoryToggle.setAttribute('role','switch');memoryToggle.setAttribute('aria-controls','memory-consolidate-cooldown');
  cooldown.id='memory-consolidate-cooldown';cooldown.dataset.motion='off';cooldown.append(field('memory.consolidateMinIntervalMs'));
  memoryState.hidden=true;memoryState.append(field('memory.consolidateEnabled'));memoryRow.append(memoryToggle,cooldown);memoryFields.prepend(memoryRow);memoryFields.append(memoryState);
  watch(['memory.consolidateEnabled'],()=>{const enabled=read('memory.consolidateEnabled')===true;memoryToggle.setAttribute('aria-checked',String(enabled));conditional(cooldown,enabled);});
  const memoryModelRow=node('div','memory-consolidate-row full'),useChatModel=action('整理使用聊天主模型',()=>write('memory.useChatModel',read('memory.useChatModel')===false));
  useChatModel.className='memory-consolidate-toggle';useChatModel.setAttribute('role','switch');useChatModel.setAttribute('aria-controls','memory-model-choice');
  memoryState.append(field('memory.useChatModel'),field('memory.provider'),field('memory.model'));
  const memoryPick=[...consolidate.querySelectorAll('button')].find(el=>el.textContent==='选择整理专用模型');
  memoryPick.setAttribute('aria-label','选择整理专用模型');memoryModel.id='memory-model-choice';memoryModel.dataset.motion='off';memoryModel.append(memoryPick);memoryModelRow.append(useChatModel,memoryModel);memoryRow.after(memoryModelRow);
  watch(['memory.useChatModel'],()=>{const shared=read('memory.useChatModel')!==false;useChatModel.setAttribute('aria-checked',String(shared));conditional(memoryModel,!shared);});
  watch(['memory.provider','memory.model'],()=>{
    const id=modelId(read('memory.model')),provider=getProviders().find(item=>item.id===read('memory.provider')),entry=provider?.models?.find(item=>modelId(item)===id)??id;
    memoryPick.textContent=id?modelLabel(provider,entry):'选择整理专用模型';memoryPick.title=id?`${provider?.displayName||read('memory.provider')||'直接接入'} · ${id}`:'';
    memoryPick.setAttribute('aria-description',id?`当前模型：${memoryPick.textContent}，${memoryPick.title}`:'尚未选择专用模型');
  });

  // Keep legacy fields as one hidden form for existing consumers. The default
  // library owns the visible manager and uses the same selected controllers.
  const personaRoot=nav.get('persona'),personaLibraryHost=node('div','persona-library full');
  const personaLibrary=mountPersonaLibrary({host:personaLibraryHost,read,commit:commitActivity,save,request,onDraftChange:onActivityChange,onIdle,doc});
  if(personaLibrary){
    const parked=node('div','persona-library-state');parked.hidden=true;parked.append(...personaRoot.fields.childNodes,personaRoot.card.querySelector('#persona-template-manager'),personaRoot.card.querySelector('#persona-by-chat-manager'));
    personaRoot.fields.replaceChildren(personaLibraryHost,parked);watch(['persona','personaUnified'],personaLibrary.sync);disposers.push(personaLibrary.dispose);
  }else{
  // A replacement presentation may opt into the earlier inline editor.
  const persona=nav.get('persona'),unified=field('personaUnified'),global=node('div','settings-fields settings-persona-global');
  global.append(...[...persona.fields.children].filter(el=>el!==unified));
  fold(global,'persona-templates','人设模板',[persona.card.querySelector('#persona-template-manager')]);
  const personaToggle=action('所有会话使用统一人设',()=>write('personaUnified',read('personaUnified')===false)),personaState=node('div','persona-unified-state');
  personaToggle.className='persona-unified-toggle';personaToggle.setAttribute('role','switch');personaToggle.setAttribute('aria-controls','persona-unified-inline persona-by-chat-manager');
  personaState.hidden=true;personaState.append(unified);persona.fields.replaceChildren(personaToggle,personaState);
  const globalEditor=modal(persona.fields,'global-persona','全局人设设置',[global],{summary:()=>read('persona.botName')||'全局默认人设'});
  const inline=node('div','settings-persona-inline full');inline.id='persona-unified-inline';persona.fields.append(inline);
  const perChat=persona.card.querySelector('#persona-by-chat-manager');
  watch(['personaUnified'],()=>{
    const shared=read('personaUnified')!==false;
    personaToggle.setAttribute('aria-checked',String(shared));
    if(shared&&global.parentNode!==inline){globalEditor.close();inline.append(global);}
    if(!shared&&global.parentNode===inline)globalEditor.parking.append(global);
    conditional(globalEditor.box,!shared);conditional(inline,shared);conditional(perChat,!shared);
  });
  }

  // Separate transport settings, like the legacy OneBot page.
  const access=nav.get('access'),link=group('access','协议端连接'),deny=group('access','拒绝与屏蔽'),onebot=nav.get('onebot');onebot.fields.append(link);
  const allowAll=field('allowAllWhenEmpty'),accessState=node('div','settings-access-state');accessState.hidden=true;accessState.append(allowAll,field('deny.groups'),field('deny.private'));access.fields.append(accessState);
  deny.querySelector(':scope > .field-group-head').remove();
  accessState.append(deny.querySelector('[data-blocklist-raw]'));
  watch(['allow','allow.groups','allow.private','allow.allGroups','allow.allPrivate','allowAllWhenEmpty'],()=>{
    const cfg={allow:read('allow'),allowAllWhenEmpty:read('allowAllWhenEmpty')};
    conditional(field('allow.groups'),!allChatsAllowed(cfg,'group'));conditional(field('allow.private'),!allChatsAllowed(cfg,'private'));
  });

  // Chat: one expanded activity card, then compact low-frequency cards.
  const chat=nav.get('chat'),tier=group('wake','响应档位'),perGroup=group('wake','分群与峰谷（高级）'),timing=group('wake','时序与并发（高级）'),mute=group('wake','群指令安静模式');
  const params=node('div','settings-fields tier-params-fields'),history=field('store.historyCount');
  history.classList.add('tier-history-count');history.querySelector('.field-title').textContent='历史消息读取';history.append(node('span','tier-history-unit','条'));
  const chatActiveRow=node('div','chat-active-row'),chatActiveState=node('div','chat-active-state'),chatActiveOptions=node('div','chat-active-options');
  const chatActiveToggle=action('活跃话题持续响应',()=>write('chatActive.enabled',read('chatActive.enabled')!==true));
  chatActiveToggle.className='chat-active-toggle';chatActiveToggle.setAttribute('role','switch');chatActiveToggle.setAttribute('aria-controls','chat-active-options');
  chatActiveOptions.id='chat-active-options';chatActiveOptions.dataset.motion='off';chatActiveOptions.append(field('chatActive.ttlMinutes'));
  chatActiveState.hidden=true;chatActiveState.append(field('chatActive.enabled'));chatActiveRow.append(chatActiveToggle,chatActiveOptions);
  params.append(field('store.keywords'),history,chatActiveRow,chatActiveState);
  watch(['chatActive.enabled'],()=>{const enabled=read('chatActive.enabled')===true;chatActiveToggle.setAttribute('aria-checked',String(enabled));conditional(chatActiveOptions,enabled);});
  const paramsEditor=modal(tier.querySelector(':scope > .settings-fields'),'tier-params','档位参数',[params]);
  const peak=field('store.peakSchedule.enabled'),peakAction=[...perGroup.querySelectorAll('button')].find(el=>el.textContent==='编辑峰谷时段与预设');
  const groupAction=[...sections.get('wake').card.querySelectorAll(':scope > button')];
  const activity=mountActivityView({read,draft:activityDraft,commit:commitActivity,onChange:onActivityChange,request,doc});watch(['store.contextSliderPos','store.unifiedTier','store.groupSliderPos','store.groupPeakPos','store.peakSchedule.enabled','store.peakSchedule.peak.sliderPos','store.peakSchedule.valley.sliderPos','allow','allow.groups','allow.allGroups','allowAllWhenEmpty'],activity.refresh);disposers.push(activity.dispose);
  const activityInner=node('div','activity-inner'),activityBody=fold(chat.fields,'activity','活跃设置',[activityInner],true),activityHead=activityBody.parentElement.querySelector('summary'),activityControls=node('span','activity-head-controls');
  activityInner.append(activity.host);activityBody.parentElement.classList.add('activity-card');
  const title=node('div','activity-title'),heading=node('h4','','活跃设置'),badge=node('span','activity-badge');title.append(heading,node('div','activity-subtitle','响应档位 / 峰谷'));
  activityHead.replaceChildren(node('div','activity-icon','⚡'),title,activityControls,badge,node('span','activity-chevron','›'));
  const peakControl=node('div','activity-peak-control'),activityUnified=field('store.unifiedTier');
  for(const wrap of [peak,activityUnified]){
    wrap.classList.remove('is-switch');wrap.classList.add('activity-switch');
    const track=node('span','activity-switch-track');track.append(node('span','activity-switch-thumb'));wrap.append(track);
  }
  peakControl.append(node('span','activity-peak-label','🌅 峰谷时段'),peak);peakControl.setAttribute('role','button');peakControl.setAttribute('aria-label','编辑峰谷时段与预设');peakControl.tabIndex=0;
  peakControl.addEventListener('click',event=>{event.stopPropagation();if(!event.target.closest('label')){event.preventDefault();if(!peakAction.disabled)peakAction.click();}});
  peakControl.addEventListener('keydown',event=>{if(event.target===peakControl&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();if(!peakAction.disabled)peakAction.click();}});
  peak.querySelector('input').setAttribute('aria-label','启用峰谷自动切档');activityUnified.querySelector('.field-title').textContent='统一设置';activityUnified.querySelector('input').setAttribute('aria-label','所有群统一档位');activityUnified.append(activityUnified.querySelector('.field-title'));
  activityControls.append(node('span','activity-head-divider'),peakControl,paramsEditor.box,activityUnified);paramsEditor.box.querySelector('button').textContent='⚙ 档位参数';
  activity.bindHeader({badge,inputs:[['store.unifiedTier',activityUnified.querySelector('input')],['store.peakSchedule.enabled',peak.querySelector('input')]]});
  // Retain the original selected controls exactly once, with their bindings,
  // outside the visible legacy card. Raw JSON is not part of the 0.4 view.
  const activityState=node('div','activity-state');activityState.hidden=true;activityState.append(tier,...groupAction,perGroup,peakAction);activityBody.append(activityState);
  const send=content('send');send.querySelector(':scope > .settings-fields').prepend(sampling,thinking,timing);
  disposers.push(mountSendSettings(send).dispose);
  fold(chat.fields,'send','信息发送配置',[send]);
  const muteFields=mute.querySelector(':scope > .settings-fields'),muteState=node('div','command-mute-state'),muteOptions=node('div','settings-fields full command-mute-options');
  const muteToggle=action('启用群指令安静模式',()=>write('commandMute.enabled',read('commandMute.enabled')!==true));
  muteToggle.className='command-mute-toggle full';muteToggle.setAttribute('role','switch');muteToggle.setAttribute('aria-controls','command-mute-options');muteOptions.id='command-mute-options';
  muteState.hidden=true;muteState.append(field('commandMute.enabled'),field('commandMute.active'));
  const quietView=mountQuietView({read,write,request,doc});disposers.push(quietView.dispose);
  muteOptions.append(...['commandMute.command','commandMute.durationMin'].map(field),quietView.element);
  muteFields.append(muteToggle,muteOptions,muteState);
  watch(['commandMute.enabled'],()=>{const enabled=read('commandMute.enabled')===true;muteToggle.setAttribute('aria-checked',String(enabled));conditional(muteOptions,enabled);});
  watch(['commandMute','allow','allowAllWhenEmpty'],()=>{field('commandMute.active').querySelector('textarea').value=JSON.stringify(read('commandMute.active')||{},null,2);quietView.refresh();});
  fold(chat.fields,'mute','指令禁言',[mute]);
  const proactive=content('active'),proactiveFields=proactive.querySelector(':scope > .settings-fields'),proactiveState=node('div','proactive-state'),proactiveOptions=node('div','settings-fields full proactive-options');
  const proactiveToggle=action('启用主动开话题',()=>write('proactive.enabled',read('proactive.enabled')!==true));
  proactiveToggle.className='proactive-toggle full';proactiveToggle.setAttribute('role','switch');proactiveToggle.setAttribute('aria-controls','proactive-options');proactiveOptions.id='proactive-options';proactiveOptions.dataset.motion='off';
  proactiveState.hidden=true;proactiveState.append(field('proactive.enabled'));proactiveOptions.append(...['proactive.probability','proactive.idleThresholdMs','proactive.checkIntervalMinMs','proactive.checkIntervalMaxMs'].map(field));
  const proactiveCompact=mountCompactSettings(proactiveOptions,{help:PROACTIVE_SETTING_HELP,id:'proactive-setting-tooltip'});disposers.push(proactiveCompact.dispose);
  proactiveFields.replaceChildren(proactiveToggle,proactiveOptions,proactiveState);
  watch(['proactive.enabled'],()=>{const enabled=read('proactive.enabled')===true;proactiveToggle.setAttribute('aria-checked',String(enabled));if(!enabled)proactiveCompact.hide();conditional(proactiveOptions,enabled);});
  fold(chat.fields,'proactive','主动开话题',[proactive]);
  const sticker=group('memory','表情');sticker.classList.add('sticker-settings');
  const stickerFields=sticker.querySelector(':scope > .settings-fields');
  for(const [path,quantity,id] of [['sticker.enabled','sticker.promptMaxStickers','sticker-context-options'],['sticker.collectEnabled','sticker.maxCollectPerHour','sticker-collect-options']]){
    const toggle=field(path),options=field(quantity),row=node('div','sticker-setting-row');
    toggle.classList.add('sticker-card-toggle');options.classList.add('sticker-setting-options');options.id=id;options.dataset.motion='off';toggle.querySelector('input').setAttribute('aria-controls',id);
    row.append(toggle,options);stickerFields.append(row);
    watch([path],()=>conditional(options,read(path)===true));
  }
  stickerFields.append(field('sticker.encourage'));
  fold(chat.fields,'sticker','表情包',[sticker]);
  deny.querySelector(':scope > .settings-fields > button').classList.add('settings-direct-action');
  chat.fields.append(...deny.querySelector(':scope > .settings-fields').children);deny.remove();
  fold(chat.fields,'security','安全与隐私（高级）',[content('security')]);

  // Desktop extras keep their original controllers, behind a single launcher.
  const desktop=nav.get('desktop');
  const interfaceFields=node('div','settings-fields');interfaceFields.append(field('ui.uikit.mode'),field('ui.refreshMs'),field('ui.showVision'));
  modal(interfaceFields,'appearance','界面与组件库',[content('uikit')],{description:'外观实时预览并自动保存；关闭后保留当前方案。'});
  const general=node('div','settings-fields');general.append(field('server.autoStart'),field('server.closeToTray'));
  const generalCard=fold(desktop.fields,'desktop-general','桌面行为',[general],true);desktop.fields.prepend(generalCard.parentElement);
  fold(desktop.fields,'desktop-interface','界面',[interfaceFields]);
  const dataActions=node('div','actions');dataActions.append(...['#open-data','#reset'].map(selector=>borrow(doc.querySelector(selector))).filter(Boolean));
  const tokenManager=[...desktop.card.querySelectorAll(':scope > button')].find(el=>el.textContent==='管理控制台访问令牌');
  const dataFields=node('div','settings-fields');dataFields.append(field('server.port'));if(tokenManager)dataActions.prepend(tokenManager);
  fold(desktop.fields,'data','数据管理',[dataFields,dataActions]);
  fold(desktop.fields,'desktop-update','版本更新',[desktop.card.querySelector('.settings-update')]);

  // Tool switches remain discoverable; large lists and prompt output are opt-in.
  const tools=nav.get('tools'),categories=[...tools.fields.children].filter(el=>el.dataset.path?.startsWith('tools.categories.'));
  tools.fields.append(field('extensions.hotReload'));
  fold(tools.fields,'tool-categories','工具类别',categories);
  fold(tools.fields,'tool-list','工具列表',[tools.card.querySelector('#tool-list')],true);
  modal(tools.fields,'prompt-preview','提示词预览',[borrow(doc.querySelector('.settings-preview'))],{description:'使用当前设置和普通字段草稿；预览不会保存配置或调用模型。'});

  for(const [id,entry] of nav){
    const meta=entry.meta;let no=meta.querySelector('.module-no');if(!no){no=node('span','module-no');meta.append(no);}
    no.textContent=String(SETTINGS_SECTIONS.findIndex(row=>row[0]===id)+1).padStart(2,'0');
  }
  host.replaceChildren(...[...nav.values()].map(entry=>entry.card));
  function refresh(changed){if(!disposed)for(const run of refreshers)if(!changed||!run.keys||run.keys.some(key=>key===changed||changed.startsWith(key+'.')))run();}refresh();
  return {
    sections:nav,canonical:canonicalSettingsSection,refresh,
    get searchDirty(){return searchSources.dirty;},
    get personaDirty(){return personaLibrary?.dirty===true;},refreshPersonas:()=>personaLibrary?.refresh(),
    activityDraft:activity.draft,saveActivity:activity.flush,get activityDirty(){return activity.dirty;},get activityVersion(){return activity.version;},activitySnapshot:activity.snapshot,discardActivity:activity.discard,
    closeEditors(){personaLibrary?.closeEditors();for(const editor of [...editors.values()].reverse())editor.close();},
    snapshot:()=>[...doc.querySelectorAll('dialog[data-settings-editor][open]')].map(dialog=>dialog.dataset.settingsEditor),
    restore(ids=[]){for(const id of ids)editors.get(id)?.show();},
    dispose(){if(disposed)return;disposed=true;for(const dispose of disposers)dispose();for(const editor of [...editors.values()].reverse())editor.close();for(const restore of restorers)restore();},
  };
}
