// stdlib (Apache-2.0, https://github.com/stdlib-js/stdlib): @stdlib/math-base-special-* — sin 0.3.1, cos 0.3.1, tan 0.3.1, atan 0.2.4, atan2 0.3.1, asin 0.2.4, acos 0.2.4, exp 0.2.5, ln 0.2.5, pow 0.3.1, hypot 0.2.4. Built by tools/build-detmath.mjs.
var mv=Object.create;var de=Object.defineProperty;var Hv=Object.getOwnPropertyDescriptor;var hv=Object.getOwnPropertyNames;var Fv=Object.getPrototypeOf,xv=Object.prototype.hasOwnProperty;var a=(r,e)=>()=>{try{return e||r((e={exports:{}}).exports,e),e.exports}catch(i){throw e=0,i}};var Tv=(r,e,i,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let u of hv(e))!xv.call(r,u)&&u!==i&&de(r,u,{get:()=>e[u],enumerable:!(t=Hv(e,u))||t.enumerable});return r};var d=(r,e,i)=>(i=r!=null?mv(Fv(r)):{},Tv(e||!r||!r.__esModule?de(i,"default",{value:r,enumerable:!0}):i,r));var m=a((bl,Oe)=>{"use strict";var Pv=2147483647;Oe.exports=Pv});var C=a((Gl,Se)=>{"use strict";var wv=2146435072;Se.exports=wv});var He=a((Ll,me)=>{"use strict";function yv(){return typeof Symbol=="function"&&typeof Symbol("foo")=="symbol"}me.exports=yv});var Fe=a((Rl,he)=>{"use strict";var Wv=He();he.exports=Wv});var Te=a((Dl,xe)=>{"use strict";var bv=Fe(),Gv=bv();function Lv(){return Gv&&typeof Symbol.toStringTag=="symbol"}xe.exports=Lv});var we=a((Ul,Pe)=>{"use strict";var Rv=Te();Pe.exports=Rv});var Tr=a((Ml,ye)=>{"use strict";var Dv=Object.prototype.toString;ye.exports=Dv});var be=a((Bl,We)=>{"use strict";var Uv=Tr();function Mv(r){return Uv.call(r)}We.exports=Mv});var Le=a((Cl,Ge)=>{"use strict";var Bv=Object.prototype.hasOwnProperty;function Cv(r,e){return r==null?!1:Bv.call(r,e)}Ge.exports=Cv});var De=a((Xl,Re)=>{"use strict";var Xv=Le();Re.exports=Xv});var Me=a((Vl,Ue)=>{"use strict";var Vv=typeof Symbol=="function"?Symbol:void 0;Ue.exports=Vv});var Ce=a((Kl,Be)=>{"use strict";var Kv=Me();Be.exports=Kv});var Ke=a((Zl,Ve)=>{"use strict";var Xe=Ce(),Zv=typeof Xe=="function"?Xe.toStringTag:"";Ve.exports=Zv});var $e=a(($l,Ze)=>{"use strict";var $v=De(),Y=Ke(),Pr=Tr();function Yv(r){var e,i,t;if(r==null)return Pr.call(r);i=r[Y],e=$v(r,Y);try{r[Y]=void 0}catch{return Pr.call(r)}return t=Pr.call(r),e?r[Y]=i:delete r[Y],t}Ze.exports=Yv});var Q=a((Yl,Ye)=>{"use strict";var Qv=we(),kv=be(),zv=$e(),wr;Qv()?wr=zv:wr=kv;Ye.exports=wr});var ke=a((Ql,Qe)=>{"use strict";var Jv=Q(),jv=typeof Uint32Array=="function";function ro(r){return jv&&r instanceof Uint32Array||Jv(r)==="[object Uint32Array]"}Qe.exports=ro});var Je=a((kl,ze)=>{"use strict";var eo=ke();ze.exports=eo});var rt=a((zl,je)=>{"use strict";var to=4294967295;je.exports=to});var tt=a((Jl,et)=>{"use strict";var io=typeof Uint32Array=="function"?Uint32Array:null;et.exports=io});var st=a((jl,at)=>{"use strict";var ao=Je(),yr=rt(),it=tt();function so(){var r,e;if(typeof it!="function")return!1;try{e=[1,3.14,-3.14,yr+1,yr+2],e=new it(e),r=ao(e)&&e[0]===1&&e[1]===3&&e[2]===yr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}at.exports=so});var nt=a((r4,ut)=>{"use strict";var uo=st();ut.exports=uo});var ot=a((e4,vt)=>{"use strict";var no=typeof Uint32Array=="function"?Uint32Array:void 0;vt.exports=no});var ct=a((t4,ft)=>{"use strict";function vo(){throw new Error("not implemented")}ft.exports=vo});var G=a((i4,pt)=>{"use strict";var oo=nt(),fo=ot(),co=ct(),Wr;oo()?Wr=fo:Wr=co;pt.exports=Wr});var qt=a((a4,lt)=>{"use strict";var po=Q(),lo=typeof Float64Array=="function";function qo(r){return lo&&r instanceof Float64Array||po(r)==="[object Float64Array]"}lt.exports=qo});var It=a((s4,_t)=>{"use strict";var _o=qt();_t.exports=_o});var Et=a((u4,At)=>{"use strict";var Io=typeof Float64Array=="function"?Float64Array:null;At.exports=Io});var dt=a((n4,gt)=>{"use strict";var Ao=It(),Nt=Et();function Eo(){var r,e;if(typeof Nt!="function")return!1;try{e=new Nt([1,3.14,-3.14,NaN]),r=Ao(e)&&e[0]===1&&e[1]===3.14&&e[2]===-3.14&&e[3]!==e[3]}catch{r=!1}return r}gt.exports=Eo});var St=a((v4,Ot)=>{"use strict";var No=dt();Ot.exports=No});var Ht=a((o4,mt)=>{"use strict";var go=typeof Float64Array=="function"?Float64Array:void 0;mt.exports=go});var Ft=a((f4,ht)=>{"use strict";function Oo(){throw new Error("not implemented")}ht.exports=Oo});var L=a((c4,xt)=>{"use strict";var So=St(),mo=Ht(),Ho=Ft(),br;So()?br=mo:br=Ho;xt.exports=br});var Pt=a((p4,Tt)=>{"use strict";var ho=Q(),Fo=typeof Uint8Array=="function";function xo(r){return Fo&&r instanceof Uint8Array||ho(r)==="[object Uint8Array]"}Tt.exports=xo});var yt=a((l4,wt)=>{"use strict";var To=Pt();wt.exports=To});var bt=a((q4,Wt)=>{"use strict";var Po=255;Wt.exports=Po});var Lt=a((_4,Gt)=>{"use strict";var wo=typeof Uint8Array=="function"?Uint8Array:null;Gt.exports=wo});var Ut=a((I4,Dt)=>{"use strict";var yo=yt(),Gr=bt(),Rt=Lt();function Wo(){var r,e;if(typeof Rt!="function")return!1;try{e=[1,3.14,-3.14,Gr+1,Gr+2],e=new Rt(e),r=yo(e)&&e[0]===1&&e[1]===3&&e[2]===Gr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}Dt.exports=Wo});var Bt=a((A4,Mt)=>{"use strict";var bo=Ut();Mt.exports=bo});var Xt=a((E4,Ct)=>{"use strict";var Go=typeof Uint8Array=="function"?Uint8Array:void 0;Ct.exports=Go});var Kt=a((N4,Vt)=>{"use strict";function Lo(){throw new Error("not implemented")}Vt.exports=Lo});var $t=a((g4,Zt)=>{"use strict";var Ro=Bt(),Do=Xt(),Uo=Kt(),Lr;Ro()?Lr=Do:Lr=Uo;Zt.exports=Lr});var Qt=a((d4,Yt)=>{"use strict";var Mo=Q(),Bo=typeof Uint16Array=="function";function Co(r){return Bo&&r instanceof Uint16Array||Mo(r)==="[object Uint16Array]"}Yt.exports=Co});var zt=a((O4,kt)=>{"use strict";var Xo=Qt();kt.exports=Xo});var jt=a((S4,Jt)=>{"use strict";var Vo=65535;Jt.exports=Vo});var ei=a((m4,ri)=>{"use strict";var Ko=typeof Uint16Array=="function"?Uint16Array:null;ri.exports=Ko});var ai=a((H4,ii)=>{"use strict";var Zo=zt(),Rr=jt(),ti=ei();function $o(){var r,e;if(typeof ti!="function")return!1;try{e=[1,3.14,-3.14,Rr+1,Rr+2],e=new ti(e),r=Zo(e)&&e[0]===1&&e[1]===3&&e[2]===Rr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}ii.exports=$o});var ui=a((h4,si)=>{"use strict";var Yo=ai();si.exports=Yo});var vi=a((F4,ni)=>{"use strict";var Qo=typeof Uint16Array=="function"?Uint16Array:void 0;ni.exports=Qo});var fi=a((x4,oi)=>{"use strict";function ko(){throw new Error("not implemented")}oi.exports=ko});var pi=a((T4,ci)=>{"use strict";var zo=ui(),Jo=vi(),jo=fi(),Dr;zo()?Dr=Jo:Dr=jo;ci.exports=Dr});var qi=a((P4,li)=>{"use strict";var r1=$t(),e1=pi(),t1={uint16:e1,uint8:r1};li.exports=t1});var Ei=a((w4,Ai)=>{"use strict";var _i=qi(),Ii;function i1(){var r,e;return r=new _i.uint16(1),r[0]=4660,e=new _i.uint8(r.buffer),e[0]===52}Ii=i1();Ai.exports=Ii});var R=a((y4,Ni)=>{"use strict";var a1=Ei();Ni.exports=a1});var di=a((W4,gi)=>{"use strict";var s1=R(),Ur;s1===!0?Ur=1:Ur=0;gi.exports=Ur});var mi=a((b4,Si)=>{"use strict";var u1=G(),n1=L(),v1=di(),Oi=new n1(1),o1=new u1(Oi.buffer);function f1(r){return Oi[0]=r,o1[v1]}Si.exports=f1});var g=a((G4,Hi)=>{"use strict";var c1=mi();Hi.exports=c1});var Fi=a((L4,hi)=>{"use strict";function p1(r){return r===0?.0416666666666666:.0416666666666666+r*(-.001388888888887411+r*2480158728947673e-20)}hi.exports=p1});var Ti=a((R4,xi)=>{"use strict";function l1(r){return r===0?-27557314351390663e-23:-27557314351390663e-23+r*(2087572321298175e-24+r*-11359647557788195e-27)}xi.exports=l1});var wi=a((D4,Pi)=>{"use strict";var q1=Fi(),_1=Ti();function I1(r,e){var i,t,u,s;return s=r*r,u=s*s,t=s*q1(s),t+=u*u*_1(s),i=.5*s,u=1-i,u+(1-u-i+(s*t-r*e))}Pi.exports=I1});var Mr=a((U4,yi)=>{"use strict";var A1=wi();yi.exports=A1});var Gi=a((M4,bi)=>{"use strict";var Wi=-.16666666666666632,E1=.00833333333332249,N1=-.0001984126982985795,g1=27557313707070068e-22,d1=-25050760253406863e-24,O1=158969099521155e-24;function S1(r,e){var i,t,u,s;return s=r*r,u=s*s,i=E1+s*(N1+s*g1)+s*u*(d1+s*O1),t=s*r,e===0?r+t*(Wi+s*i):r-(s*(.5*e-t*i)-e-t*Wi)}bi.exports=S1});var Br=a((B4,Li)=>{"use strict";var m1=Gi();Li.exports=m1});var Cr=a((C4,Ri)=>{"use strict";var H1=1048575;Ri.exports=H1});var Ui=a((X4,Di)=>{"use strict";var h1=R(),Xr;h1===!0?Xr=0:Xr=1;Di.exports=Xr});var Ci=a((V4,Bi)=>{"use strict";var F1=G(),x1=L(),T1=Ui(),Mi=new x1(1),P1=new F1(Mi.buffer);function w1(r){return Mi[0]=r,P1[T1]}Bi.exports=w1});var Vi=a((K4,Xi)=>{"use strict";var y1=Ci();Xi.exports=y1});var $i=a((Z4,Zi)=>{"use strict";var W1=R(),Ki,Vr,Kr;W1===!0?(Vr=1,Kr=0):(Vr=0,Kr=1);Ki={HIGH:Vr,LOW:Kr};Zi.exports=Ki});var Ji=a(($4,zi)=>{"use strict";var b1=G(),G1=L(),Qi=$i(),ki=new G1(1),Yi=new b1(ki.buffer),L1=Qi.HIGH,R1=Qi.LOW;function D1(r,e){return Yi[L1]=r,Yi[R1]=e,ki[0]}zi.exports=D1});var tr=a((Y4,ji)=>{"use strict";var U1=Ji();ji.exports=U1});var e0=a((Q4,r0)=>{"use strict";var M1=Math.floor;r0.exports=M1});var ir=a((k4,t0)=>{"use strict";var B1=e0();t0.exports=B1});var S=a((z4,i0)=>{"use strict";var C1=Number.POSITIVE_INFINITY;i0.exports=C1});var s0=a((J4,a0)=>{"use strict";a0.exports=Number});var n0=a((j4,u0)=>{"use strict";var X1=s0();u0.exports=X1});var x=a((r9,v0)=>{"use strict";var V1=n0(),K1=V1.NEGATIVE_INFINITY;v0.exports=K1});var X=a((e9,o0)=>{"use strict";var Z1=1023;o0.exports=Z1});var c0=a((t9,f0)=>{"use strict";var $1=1023;f0.exports=$1});var l0=a((i9,p0)=>{"use strict";var Y1=-1023;p0.exports=Y1});var _0=a((a9,q0)=>{"use strict";var Q1=-1074;q0.exports=Q1});var A0=a((s9,I0)=>{"use strict";function k1(r){return r!==r}I0.exports=k1});var O=a((u9,E0)=>{"use strict";var z1=A0();E0.exports=z1});var g0=a((n9,N0)=>{"use strict";var J1=S(),j1=x();function rf(r){return r===J1||r===j1}N0.exports=rf});var V=a((v9,d0)=>{"use strict";var ef=g0();d0.exports=ef});var S0=a((o9,O0)=>{"use strict";var tf=2147483648;O0.exports=tf});var H0=a((f9,m0)=>{"use strict";var af=typeof Object.defineProperty=="function"?Object.defineProperty:null;m0.exports=af});var F0=a((c9,h0)=>{"use strict";var sf=H0();function uf(){try{return sf({},"x",{}),!0}catch{return!1}}h0.exports=uf});var T0=a((p9,x0)=>{"use strict";var nf=Object.defineProperty;x0.exports=nf});var Zr=a((l9,P0)=>{"use strict";function vf(r){return typeof r=="number"}P0.exports=vf});var $r=a((q9,y0)=>{"use strict";function of(r){return r[0]==="-"}function w0(r){var e="",i;for(i=0;i<r;i++)e+="0";return e}function ff(r,e,i){var t=!1,u=e-r.length;return u<0||(of(r)&&(t=!0,r=r.substr(1)),r=i?r+w0(u):w0(u)+r,t&&(r="-"+r)),r}y0.exports=ff});var L0=a((_9,G0)=>{"use strict";var cf=Zr(),W0=$r(),pf=String.prototype.toLowerCase,b0=String.prototype.toUpperCase;function lf(r){var e,i,t;switch(r.specifier){case"b":e=2;break;case"o":e=8;break;case"x":case"X":e=16;break;default:e=10;break}if(i=r.arg,t=parseInt(i,10),!isFinite(t)){if(!cf(i))throw new Error("invalid integer. Value: "+i);t=0}return t<0&&(r.specifier==="u"||e!==10)&&(t=4294967295+t+1),t<0?(i=(-t).toString(e),r.precision&&(i=W0(i,r.precision,r.padRight)),i="-"+i):(i=t.toString(e),!t&&!r.precision?i="":r.precision&&(i=W0(i,r.precision,r.padRight)),r.sign&&(i=r.sign+i)),e===16&&(r.alternate&&(i="0x"+i),i=r.specifier===b0.call(r.specifier)?b0.call(i):pf.call(i)),e===8&&r.alternate&&i.charAt(0)!=="0"&&(i="0"+i),i}G0.exports=lf});var D0=a((I9,R0)=>{"use strict";function qf(r){return typeof r=="string"}R0.exports=qf});var B0=a((A9,M0)=>{"use strict";var _f=Math.abs,If=String.prototype.toLowerCase,U0=String.prototype.toUpperCase,D=String.prototype.replace,Af=/e\+(\d)$/,Ef=/e-(\d)$/,Nf=/^(\d+)$/,gf=/^(\d+)e/,df=/\.0$/,Of=/\.0*e/,Sf=/(\..*[^0])0*e/;function mf(r,e){var i,t;switch(e.specifier){case"e":case"E":t=r.toExponential(e.precision);break;case"f":case"F":t=r.toFixed(e.precision);break;case"g":case"G":_f(r)<1e-4?(i=e.precision,i>0&&(i-=1),t=r.toExponential(i)):t=r.toPrecision(e.precision),e.alternate||(t=D.call(t,Sf,"$1e"),t=D.call(t,Of,"e"),t=D.call(t,df,""));break;default:throw new Error("invalid double notation. Value: "+e.specifier)}return t=D.call(t,Af,"e+0$1"),t=D.call(t,Ef,"e-0$1"),e.alternate&&(t=D.call(t,Nf,"$1."),t=D.call(t,gf,"$1.e")),r>=0&&e.sign&&(t=e.sign+t),t=e.specifier===U0.call(e.specifier)?U0.call(t):If.call(t),t}M0.exports=mf});var V0=a((E9,X0)=>{"use strict";function C0(r){var e="",i;for(i=0;i<r;i++)e+=" ";return e}function Hf(r,e,i){var t=e-r.length;return t<0||(r=i?r+C0(t):C0(t)+r),r}X0.exports=Hf});var Z0=a((N9,K0)=>{"use strict";var hf=L0(),Ff=D0(),xf=Zr(),Tf=B0(),Pf=V0(),wf=$r(),yf=String.fromCharCode,Wf=Array.isArray;function ar(r){return r!==r}function bf(r){var e={};return e.specifier=r.specifier,e.precision=r.precision===void 0?1:r.precision,e.width=r.width,e.flags=r.flags||"",e.mapping=r.mapping,e}function Gf(r){var e,i,t,u,s,f,v,l,o,n;if(!Wf(r))throw new TypeError("invalid argument. First argument must be an array. Value: `"+r+"`.");for(f="",v=1,o=0;o<r.length;o++)if(t=r[o],Ff(t))f+=t;else{if(e=t.precision!==void 0,t=bf(t),!t.specifier)throw new TypeError("invalid argument. Token is missing `specifier` property. Index: `"+o+"`. Value: `"+t+"`.");for(t.mapping&&(v=t.mapping),i=t.flags,n=0;n<i.length;n++)switch(u=i.charAt(n),u){case" ":t.sign=" ";break;case"+":t.sign="+";break;case"-":t.padRight=!0,t.padZeros=!1;break;case"0":t.padZeros=i.indexOf("-")<0;break;case"#":t.alternate=!0;break;default:throw new Error("invalid flag: "+u)}if(t.width==="*"){if(t.width=parseInt(arguments[v],10),v+=1,ar(t.width))throw new TypeError("the argument for * width at position "+v+" is not a number. Value: `"+t.width+"`.");t.width<0&&(t.padRight=!0,t.width=-t.width)}if(e&&t.precision==="*"){if(t.precision=parseInt(arguments[v],10),v+=1,ar(t.precision))throw new TypeError("the argument for * precision at position "+v+" is not a number. Value: `"+t.precision+"`.");t.precision<0&&(t.precision=1,e=!1)}switch(t.arg=arguments[v],t.specifier){case"b":case"o":case"x":case"X":case"d":case"i":case"u":e&&(t.padZeros=!1),t.arg=hf(t);break;case"s":t.maxWidth=e?t.precision:-1,t.arg=String(t.arg);break;case"c":if(!ar(t.arg)){if(s=parseInt(t.arg,10),s<0||s>127)throw new Error("invalid character code. Value: "+t.arg);t.arg=ar(s)?String(t.arg):yf(s)}break;case"e":case"E":case"f":case"F":case"g":case"G":if(e||(t.precision=6),l=parseFloat(t.arg),!isFinite(l)){if(!xf(t.arg))throw new Error("invalid floating-point number. Value: "+f);l=t.arg,t.padZeros=!1}t.arg=Tf(l,t);break;default:throw new Error("invalid specifier: "+t.specifier)}t.maxWidth>=0&&t.arg.length>t.maxWidth&&(t.arg=t.arg.substring(0,t.maxWidth)),t.padZeros?t.arg=wf(t.arg,t.width||t.precision,t.padRight):t.width&&(t.arg=Pf(t.arg,t.width,t.padRight)),f+=t.arg||"",v+=1}return f}K0.exports=Gf});var Y0=a((g9,$0)=>{"use strict";var Lf=Z0();$0.exports=Lf});var k0=a((d9,Q0)=>{"use strict";var sr=/%(?:([1-9]\d*)\$)?([0 +\-#]*)(\*|\d+)?(?:(\.)(\*|\d+)?)?[hlL]?([%A-Za-z])/g;function Rf(r){var e={mapping:r[1]?parseInt(r[1],10):void 0,flags:r[2],width:r[3],precision:r[5],specifier:r[6]};return r[4]==="."&&r[5]===void 0&&(e.precision="1"),e}function Df(r){var e,i,t,u;for(i=[],u=0,t=sr.exec(r);t;)e=r.slice(u,sr.lastIndex-t[0].length),e.length&&i.push(e),t[6]==="%"?i.push("%"):i.push(Rf(t)),u=sr.lastIndex,t=sr.exec(r);return e=r.slice(u),e.length&&i.push(e),i}Q0.exports=Df});var J0=a((O9,z0)=>{"use strict";var Uf=k0();z0.exports=Uf});var ra=a((S9,j0)=>{"use strict";function Mf(r){return typeof r=="string"}j0.exports=Mf});var ia=a((m9,ta)=>{"use strict";var Bf=Y0(),Cf=J0(),Xf=ra();function ea(r){var e,i;if(!Xf(r))throw new TypeError(ea("invalid argument. First argument must be a string. Value: `%s`.",r));for(e=[Cf(r)],i=1;i<arguments.length;i++)e.push(arguments[i]);return Bf.apply(null,e)}ta.exports=ea});var sa=a((H9,aa)=>{"use strict";var Vf=ia();aa.exports=Vf});var ca=a((h9,fa)=>{"use strict";var ua=sa(),K=Object.prototype,na=K.toString,va=K.__defineGetter__,oa=K.__defineSetter__,Kf=K.__lookupGetter__,Zf=K.__lookupSetter__;function $f(r,e,i){var t,u,s,f;if(typeof r!="object"||r===null||na.call(r)==="[object Array]")throw new TypeError(ua("invalid argument. First argument must be an object. Value: `%s`.",r));if(typeof i!="object"||i===null||na.call(i)==="[object Array]")throw new TypeError(ua("invalid argument. Property descriptor must be an object. Value: `%s`.",i));if(u="value"in i,u&&(Kf.call(r,e)||Zf.call(r,e)?(t=r.__proto__,r.__proto__=K,delete r[e],r[e]=i.value,r.__proto__=t):r[e]=i.value),s="get"in i,f="set"in i,u&&(s||f))throw new Error("invalid argument. Cannot specify one or more accessors and a value or writable attribute in the property descriptor.");return s&&va&&va.call(r,e,i.get),f&&oa&&oa.call(r,e,i.set),r}fa.exports=$f});var la=a((F9,pa)=>{"use strict";var Yf=F0(),Qf=T0(),kf=ca(),Yr;Yf()?Yr=Qf:Yr=kf;pa.exports=Yr});var _a=a((x9,qa)=>{"use strict";var zf=la();function Jf(r,e,i){zf(r,e,{configurable:!1,enumerable:!1,writable:!1,value:i})}qa.exports=Jf});var Qr=a((T9,Ia)=>{"use strict";var jf=_a();Ia.exports=jf});var Na=a((P9,Ea)=>{"use strict";var r6=R(),Aa,kr,zr;r6===!0?(kr=1,zr=0):(kr=0,zr=1);Aa={HIGH:kr,LOW:zr};Ea.exports=Aa});var Jr=a((w9,Sa)=>{"use strict";var e6=G(),t6=L(),da=Na(),Oa=new t6(1),ga=new e6(Oa.buffer),i6=da.HIGH,a6=da.LOW;function s6(r,e,i,t){return Oa[0]=r,e[t]=ga[i6],e[t+i]=ga[a6],e}Sa.exports=s6});var Ha=a((y9,ma)=>{"use strict";var u6=Jr();function n6(r){return u6(r,[0,0],1,0)}ma.exports=n6});var ur=a((W9,Fa)=>{"use strict";var v6=Qr(),ha=Ha(),o6=Jr();v6(ha,"assign",o6);Fa.exports=ha});var Ta=a((b9,xa)=>{"use strict";var f6=S0(),c6=m(),p6=ur(),l6=g(),q6=tr(),jr=[0,0];function _6(r,e){var i,t;return p6.assign(r,jr,1,0),i=jr[0],i&=c6,t=l6(e),t&=f6,i|=t,q6(i,jr[1])}xa.exports=_6});var nr=a((G9,Pa)=>{"use strict";var I6=Ta();Pa.exports=I6});var ya=a((L9,wa)=>{"use strict";var A6=22250738585072014e-324;wa.exports=A6});var ba=a((R9,Wa)=>{"use strict";function E6(r){return Math.abs(r)}Wa.exports=E6});var vr=a((D9,Ga)=>{"use strict";var N6=ba();Ga.exports=N6});var re=a((U9,La)=>{"use strict";var g6=ya(),d6=V(),O6=O(),S6=vr(),m6=4503599627370496;function H6(r,e,i,t){return O6(r)||d6(r)?(e[t]=r,e[t+i]=0,e):r!==0&&S6(r)<g6?(e[t]=r*m6,e[t+i]=-52,e):(e[t]=r,e[t+i]=0,e)}La.exports=H6});var Da=a((M9,Ra)=>{"use strict";var h6=re();function F6(r){return h6(r,[0,0],1,0)}Ra.exports=F6});var Ba=a((B9,Ma)=>{"use strict";var x6=Qr(),Ua=Da(),T6=re();x6(Ua,"assign",T6);Ma.exports=Ua});var Xa=a((C9,Ca)=>{"use strict";var P6=g(),w6=C(),y6=X();function W6(r){var e=P6(r);return e=(e&w6)>>>20,e-y6|0}Ca.exports=W6});var Ka=a((X9,Va)=>{"use strict";var b6=Xa();Va.exports=b6});var $a=a((V9,Za)=>{"use strict";var G6=S(),L6=x(),R6=X(),D6=c0(),U6=l0(),M6=_0(),B6=O(),C6=V(),X6=nr(),V6=Ba().assign,K6=Ka(),Z6=ur(),$6=tr(),Y6=2220446049250313e-31,Q6=2148532223,ee=[0,0],te=[0,0];function k6(r,e){var i,t;return e===0||r===0||B6(r)||C6(r)?r:(V6(r,ee,1,0),r=ee[0],e+=ee[1],e+=K6(r),e<M6?X6(0,r):e>D6?r<0?L6:G6:(e<=U6?(e+=52,t=Y6):t=1,Z6.assign(r,te,1,0),i=te[0],i&=Q6,i|=e+R6<<20,t*$6(i,te[1])))}Za.exports=k6});var or=a((K9,Ya)=>{"use strict";var z6=$a();Ya.exports=z6});var ka=a((Z9,Qa)=>{"use strict";function J6(r,e){var i,t;for(i=[],t=0;t<e;t++)i.push(r);return i}Qa.exports=J6});var Ja=a(($9,za)=>{"use strict";var j6=ka();za.exports=j6});var rs=a((Y9,ja)=>{"use strict";var r2=Ja();function e2(r){return r2(0,r)}ja.exports=e2});var ts=a((Q9,es)=>{"use strict";var t2=rs();es.exports=t2});var ns=a((k9,us)=>{"use strict";var i2=ir(),fr=or(),lr=ts(),as=[10680707,7228996,1387004,2578385,16069853,12639074,9804092,4427841,16666979,11263675,12935607,2387514,4345298,14681673,3074569,13734428,16653803,1880361,10960616,8533493,3062596,8710556,7349940,6258241,3772886,3769171,3798172,8675211,12450088,3874808,9961438,366607,15675153,9132554,7151469,3571407,2607881,12013382,4155038,6285869,7677882,13102053,15825725,473591,9065106,15363067,6271263,9264392,5636912,4652155,7056368,13614112,10155062,1944035,9527646,15080200,6658437,6231200,6832269,16767104,5075751,3212806,1398474,7579849,6349435,12618859],a2=[1.570796251296997,7549789415861596e-23,5390302529957765e-30,3282003415807913e-37,1270655753080676e-44,12293330898111133e-52,27337005381646456e-60,21674168387780482e-67],ie=16777216,ae=5960464477539063e-23,cr=lr(20),is=lr(20),pr=lr(20),E=lr(20);function ss(r,e,i,t,u,s,f,v,l){var o,n,p,I,c,A,N,q,_;for(I=s,_=t[i],q=i,c=0;q>0;c++)n=ae*_|0,E[c]=_-ie*n|0,_=t[q-1]+n,q-=1;if(_=fr(_,u),_-=8*i2(_*.125),N=_|0,_-=N,p=0,u>0?(c=E[i-1]>>24-u,N+=c,E[i-1]-=c<<24-u,p=E[i-1]>>23-u):u===0?p=E[i-1]>>23:_>=.5&&(p=2),p>0){for(N+=1,o=0,c=0;c<i;c++)q=E[c],o===0?q!==0&&(o=1,E[c]=16777216-q):E[c]=16777215-q;if(u>0)switch(u){case 1:E[i-1]&=8388607;break;case 2:E[i-1]&=4194303;break}p===2&&(_=1-_,o!==0&&(_-=fr(1,u)))}if(_===0){for(q=0,c=i-1;c>=s;c--)q|=E[c];if(q===0){for(A=1;E[s-A]===0;A++);for(c=i+1;c<=i+A;c++){for(l[v+c]=as[f+c],n=0,q=0;q<=v;q++)n+=r[q]*l[v+(c-q)];t[c]=n}return i+=A,ss(r,e,i,t,u,s,f,v,l)}for(i-=1,u-=24;E[i]===0;)i-=1,u-=24}else _=fr(_,-u),_>=ie?(n=ae*_|0,E[i]=_-ie*n|0,i+=1,u+=24,E[i]=n):E[i]=_|0;for(n=fr(1,u),c=i;c>=0;c--)t[c]=n*E[c],n*=ae;for(c=i;c>=0;c--){for(n=0,A=0;A<=I&&A<=i-c;A++)n+=a2[A]*t[c+A];pr[i-c]=n}for(n=0,c=i;c>=0;c--)n+=pr[c];for(p===0?e[0]=n:e[0]=-n,n=pr[0]-n,c=1;c<=i;c++)n+=pr[c];return p===0?e[1]=n:e[1]=-n,N&7}function s2(r,e,i,t){var u,s,f,v,l,o,n,p,I;for(s=4,v=t-1,f=(i-3)/24|0,f<0&&(f=0),o=i-24*(f+1),p=f-v,I=v+s,n=0;n<=I;n++)p<0?cr[n]=0:cr[n]=as[p],p+=1;for(n=0;n<=s;n++){for(u=0,p=0;p<=v;p++)u+=r[p]*cr[v+(n-p)];is[n]=u}return l=s,ss(r,e,l,is,o,s,f,v,cr)}us.exports=s2});var os=a((z9,vs)=>{"use strict";var u2=Math.round;vs.exports=u2});var cs=a((J9,fs)=>{"use strict";var n2=os();fs.exports=n2});var _s=a((j9,qs)=>{"use strict";var v2=cs(),ps=g(),o2=.6366197723675814,f2=1.5707963267341256,c2=6077100506506192e-26,p2=6077100506303966e-26,l2=20222662487959506e-37,q2=20222662487111665e-37,_2=84784276603689e-45,ls=2047;function I2(r,e,i){var t,u,s,f,v,l,o;return u=v2(r*o2),f=r-u*f2,v=u*c2,o=e>>20|0,i[0]=f-v,t=ps(i[0]),l=o-(t>>20&ls),l>16&&(s=f,v=u*p2,f=s-v,v=u*l2-(s-f-v),i[0]=f-v,t=ps(i[0]),l=o-(t>>20&ls),l>49&&(s=f,v=u*q2,f=s-v,v=u*_2-(s-f-v),i[0]=f-v)),i[1]=f-i[0]-v,u}qs.exports=I2});var As=a((r5,Is)=>{"use strict";var A2=m(),E2=C(),N2=Cr(),g2=g(),d2=Vi(),O2=tr(),S2=ns(),qr=_s(),m2=0,H2=16777216,T=1.5707963267341256,U=6077100506506192e-26,_r=2*U,Ir=3*U,Ar=4*U,h2=598523,F2=1072243195,x2=1073928572,T2=1074752122,P2=1074977148,w2=1075183036,y2=1075388923,W2=1075594811,b2=1094263291,k=[0,0,0],z=[0,0];function G2(r,e){var i,t,u,s,f,v,l,o;if(u=g2(r)|0,s=u&A2|0,s<=F2)return e[0]=r,e[1]=0,0;if(s<=T2)return(s&N2)===h2?qr(r,s,e):s<=x2?u>0?(o=r-T,e[0]=o-U,e[1]=o-e[0]-U,1):(o=r+T,e[0]=o+U,e[1]=o-e[0]+U,-1):u>0?(o=r-2*T,e[0]=o-_r,e[1]=o-e[0]-_r,2):(o=r+2*T,e[0]=o+_r,e[1]=o-e[0]+_r,-2);if(s<=W2)return s<=w2?s===P2?qr(r,s,e):u>0?(o=r-3*T,e[0]=o-Ir,e[1]=o-e[0]-Ir,3):(o=r+3*T,e[0]=o+Ir,e[1]=o-e[0]+Ir,-3):s===y2?qr(r,s,e):u>0?(o=r-4*T,e[0]=o-Ar,e[1]=o-e[0]-Ar,4):(o=r+4*T,e[0]=o+Ar,e[1]=o-e[0]+Ar,-4);if(s<b2)return qr(r,s,e);if(s>=E2)return e[0]=NaN,e[1]=NaN,0;for(i=d2(r),t=(s>>20)-1046,o=O2(s-(t<<20|0),i),v=0;v<2;v++)k[v]=o|0,o=(o-k[v])*H2;for(k[2]=o,f=3;k[f-1]===m2;)f-=1;return l=S2(k,z,t,f,1),u<0?(e[0]=-z[0],e[1]=-z[1],-l):(e[0]=z[0],e[1]=z[1],l)}Is.exports=G2});var Er=a((e5,Es)=>{"use strict";var L2=As();Es.exports=L2});var ds=a((t5,gs)=>{"use strict";var R2=m(),D2=C(),U2=g(),Ns=Mr(),se=Br(),M2=Er(),B2=1072243195,C2=1045430272,H=[0,0];function X2(r){var e,i;if(e=U2(r),e&=R2,e<=B2)return e<C2?r:se(r,0);if(e>=D2)return NaN;switch(i=M2(r,H),i&3){case 0:return se(H[0],H[1]);case 1:return Ns(H[0],H[1]);case 2:return-se(H[0],H[1]);default:return-Ns(H[0],H[1])}}gs.exports=X2});var Ss=a((i5,Os)=>{"use strict";var V2=ds();Os.exports=V2});var hs=a((a5,Hs)=>{"use strict";var K2=g(),ue=Mr(),ms=Br(),Z2=Er(),$2=m(),Y2=C(),h=[0,0],Q2=1072243195,k2=1044381696;function z2(r){var e,i;if(e=K2(r),e&=$2,e<=Q2)return e<k2?1:ue(r,0);if(e>=Y2)return NaN;switch(i=Z2(r,h),i&3){case 0:return ue(h[0],h[1]);case 1:return-ms(h[0],h[1]);case 2:return-ue(h[0],h[1]);default:return ms(h[0],h[1])}}Hs.exports=z2});var xs=a((s5,Fs)=>{"use strict";var J2=hs();Fs.exports=J2});var Ps=a((u5,Ts)=>{"use strict";var j2=R(),ne;j2===!0?ne=0:ne=1;Ts.exports=ne});var ys=a((n5,ws)=>{"use strict";var rc=G(),ec=L(),tc=Ps(),ve=new ec(1),ic=new rc(ve.buffer);function ac(r,e){return ve[0]=r,ic[tc]=e>>>0,ve[0]}ws.exports=ac});var Z=a((v5,Ws)=>{"use strict";var sc=ys();Ws.exports=sc});var Gs=a((o5,bs)=>{"use strict";function uc(r){return r===0?.13333333333320124:.13333333333320124+r*(.021869488294859542+r*(.0035920791075913124+r*(.0005880412408202641+r*(7817944429395571e-20+r*-18558637485527546e-21))))}bs.exports=uc});var Rs=a((f5,Ls)=>{"use strict";function nc(r){return r===0?.05396825397622605:.05396825397622605+r*(.0088632398235993+r*(.0014562094543252903+r*(.0002464631348184699+r*(7140724913826082e-20+r*2590730518636337e-20))))}Ls.exports=nc});var Ms=a((c5,Us)=>{"use strict";var vc=g(),Ds=Z(),oc=Gs(),fc=Rs(),cc=.7853981633974483,pc=3061616997868383e-32,lc=.3333333333333341,qc=2147483647;function _c(r,e,i){var t,u,s,f,v,l,o,n,p;return t=vc(r),u=t&qc|0,u>=1072010280&&(r<0&&(r=-r,e=-e),p=cc-r,n=pc-e,r=p+n,e=0),p=r*r,n=p*p,f=oc(n),o=p*fc(n),v=p*r,f=e+p*(v*(f+o)+e),f+=lc*v,n=r+f,u>=1072010280?(o=i,(1-(t>>30&2))*(o-2*(r-(n*n/(n+o)-f)))):i===1?n:(p=Ds(n,0),o=f-(p-r),s=-1/n,l=Ds(s,0),v=1+l*p,l+s*(v+l*o))}Us.exports=_c});var Cs=a((p5,Bs)=>{"use strict";var Ic=Ms();Bs.exports=Ic});var Ks=a((l5,Vs)=>{"use strict";var Ac=g(),Xs=Cs(),Ec=Er(),Nc=m(),gc=C(),oe=[0,0],dc=1072243195,Oc=1044381696;function Sc(r){var e,i;return e=Ac(r),e&=Nc,e<=dc?e<Oc?r:Xs(r,0,1):e>=gc?NaN:(i=Ec(r,oe),Xs(oe[0],oe[1],1-((i&1)<<1)))}Vs.exports=Sc});var $s=a((q5,Zs)=>{"use strict";var mc=Ks();Zs.exports=mc});var Qs=a((_5,Ys)=>{"use strict";var Hc=1.5707963267948966;Ys.exports=Hc});var Nr=a((I5,ks)=>{"use strict";var hc=.7853981633974483;ks.exports=hc});var Js=a((A5,zs)=>{"use strict";function Fc(r){return r===0?-64.85021904942025:-64.85021904942025+r*(-122.88666844901361+r*(-75.00855792314705+r*(-16.157537187333652+r*-.8750608600031904)))}zs.exports=Fc});var ru=a((E5,js)=>{"use strict";function xc(r){return r===0?194.5506571482614:194.5506571482614+r*(485.3903996359137+r*(432.88106049129027+r*(165.02700983169885+r*(24.858464901423062+r*1))))}js.exports=xc});var iu=a((N5,tu)=>{"use strict";var Tc=O(),Pc=S(),fe=Qs(),wc=Nr(),yc=x(),Wc=Js(),bc=ru(),eu=6123233995736766e-32,Gc=2.414213562373095;function Lc(r){var e,i,t,u;return Tc(r)||r===0?r:r===Pc?fe:r===yc?-fe:(r<0&&(i=!0,r=-r),e=0,r>Gc?(t=fe,e=1,r=-(1/r)):r<=.66?t=0:(t=wc,e=2,r=(r-1)/(r+1)),u=r*r,u=u*Wc(u)/bc(u),u=r*u+r,e===2?u+=.5*eu:e===1&&(u+=eu),t+=u,i?-t:t)}tu.exports=Lc});var ce=a((g5,au)=>{"use strict";var Rc=iu();au.exports=Rc});var uu=a((d5,su)=>{"use strict";var Dc=g();function Uc(r){var e=Dc(r);return!!(e>>>31)}su.exports=Uc});var vu=a((O5,nu)=>{"use strict";var Mc=uu();nu.exports=Mc});var fu=a((S5,ou)=>{"use strict";var Bc=3.141592653589793;ou.exports=Bc});var lu=a((m5,pu)=>{"use strict";var gr=V(),P=nr(),Cc=vu(),cu=O(),Xc=ce(),Vc=S(),w=fu();function Kc(r,e){var i;return cu(e)||cu(r)?NaN:gr(e)?e===Vc?gr(r)?P(w/4,r):P(0,r):gr(r)?P(3*w/4,r):P(w,r):gr(r)?P(w/2,r):r===0?e>=0&&!Cc(e)?P(0,r):P(w,r):e===0?P(w/2,r):(i=Xc(r/e),e<0?i<=0?i+w:i-w:i)}pu.exports=Kc});var _u=a((H5,qu)=>{"use strict";var Zc=lu();qu.exports=Zc});var Au=a((h5,Iu)=>{"use strict";var $c=Math.sqrt;Iu.exports=$c});var J=a((F5,Eu)=>{"use strict";var Yc=Au();Eu.exports=Yc});var gu=a((x5,Nu)=>{"use strict";function Qc(r){var e,i,t;return r===0?.16666666666666713:(r<0?e=-r:e=r,e<=1?(i=-8.198089802484825+r*(19.562619833175948+r*(-16.262479672107002+r*(5.444622390564711+r*(-.6019598008014124+r*.004253011369004428)))),t=-49.18853881490881+r*(139.51056146574857+r*(-147.1791292232726+r*(70.49610280856842+r*(-14.740913729888538+r*1))))):(r=1/r,i=.004253011369004428+r*(-.6019598008014124+r*(5.444622390564711+r*(-16.262479672107002+r*(19.562619833175948+r*-8.198089802484825)))),t=1+r*(-14.740913729888538+r*(70.49610280856842+r*(-147.1791292232726+r*(139.51056146574857+r*-49.18853881490881))))),i/t)}Nu.exports=Qc});var Ou=a((T5,du)=>{"use strict";function kc(r){var e,i,t;return r===0?.08333333333333809:(r<0?e=-r:e=r,e<=1?(i=28.536655482610616+r*(-25.56901049652825+r*(6.968710824104713+r*(-.5634242780008963+r*.002967721961301243))),t=342.43986579130785+r*(-383.8770957603691+r*(147.0656354026815+r*(-21.947795316429207+r*1)))):(r=1/r,i=.002967721961301243+r*(-.5634242780008963+r*(6.968710824104713+r*(-25.56901049652825+r*28.536655482610616))),t=1+r*(-21.947795316429207+r*(147.0656354026815+r*(-383.8770957603691+r*342.43986579130785)))),i/t)}du.exports=kc});var Hu=a((P5,mu)=>{"use strict";var zc=O(),Jc=J(),Su=Nr(),jc=gu(),r3=Ou(),e3=6123233995736766e-32;function t3(r){var e,i,t,u,s;if(zc(r))return NaN;if(r>0?t=r:(e=!0,t=-r),t>1)return NaN;if(t>.625)i=1-t,u=i*r3(i),i=Jc(i+i),s=Su-i,i=i*u-e3,s-=i,s+=Su;else{if(t<1e-8)return r;i=t*t,s=i*jc(i),s=t*s+t}return e?-s:s}mu.exports=t3});var pe=a((w5,hu)=>{"use strict";var i3=Hu();hu.exports=i3});var Pu=a((y5,Tu)=>{"use strict";var a3=O(),Fu=pe(),s3=J(),xu=Nr(),u3=6123233995736766e-32;function n3(r){var e;return a3(r)?NaN:r<-1||r>1?NaN:r>.5?2*Fu(s3(.5-.5*r)):(e=xu-Fu(r),e+=u3,e+=xu,e)}Tu.exports=n3});var yu=a((W5,wu)=>{"use strict";var v3=Pu();wu.exports=v3});var bu=a((b5,Wu)=>{"use strict";var o3=Math.ceil;Wu.exports=o3});var Lu=a((G5,Gu)=>{"use strict";var f3=bu();Gu.exports=f3});var Du=a((L5,Ru)=>{"use strict";var c3=ir(),p3=Lu();function l3(r){return r<0?p3(r):c3(r)}Ru.exports=l3});var Mu=a((R5,Uu)=>{"use strict";var q3=Du();Uu.exports=q3});var Cu=a((D5,Bu)=>{"use strict";function _3(r){return r===0?.16666666666666602:.16666666666666602+r*(-.0027777777777015593+r*(6613756321437934e-20+r*(-16533902205465252e-22+r*41381367970572385e-24)))}Bu.exports=_3});var Vu=a((U5,Xu)=>{"use strict";var I3=or(),A3=Cu();function E3(r,e,i){var t,u,s,f;return t=r-e,u=t*t,s=t-u*A3(u),f=1-(e-t*s/(2-s)-r),I3(f,i)}Xu.exports=E3});var ku=a((M5,Qu)=>{"use strict";var N3=O(),Ku=Mu(),g3=x(),Zu=S(),d3=Vu(),O3=.6931471803691238,S3=19082149292705877e-26,$u=1.4426950408889634,m3=709.782712893384,H3=-745.1332191019411,Yu=1/(1<<28),h3=-Yu;function F3(r){var e,i,t;return N3(r)||r===Zu?r:r===g3?0:r>m3?Zu:r<H3?0:r>h3&&r<Yu?1+r:(r<0?t=Ku($u*r-.5):t=Ku($u*r+.5),e=r-t*O3,i=t*S3,d3(e,i,t))}Qu.exports=F3});var Ju=a((B5,zu)=>{"use strict";var x3=ku();zu.exports=x3});var rn=a((C5,ju)=>{"use strict";var T3=R(),le;T3===!0?le=1:le=0;ju.exports=le});var tn=a((X5,en)=>{"use strict";var P3=G(),w3=L(),y3=rn(),qe=new w3(1),W3=new P3(qe.buffer);function b3(r,e){return qe[0]=r,W3[y3]=e>>>0,qe[0]}en.exports=b3});var dr=a((V5,an)=>{"use strict";var G3=tn();an.exports=G3});var un=a((K5,sn)=>{"use strict";function L3(r){return r===0?.3999999999940942:.3999999999940942+r*(.22222198432149784+r*.15313837699209373)}sn.exports=L3});var vn=a((Z5,nn)=>{"use strict";function R3(r){return r===0?.6666666666666735:.6666666666666735+r*(.2857142874366239+r*(.1818357216161805+r*.14798198605116586))}nn.exports=R3});var pn=a(($5,cn)=>{"use strict";var on=g(),D3=dr(),U3=O(),M3=X(),B3=x(),C3=un(),X3=vn(),Or=.6931471803691238,Sr=19082149292705877e-26,V3=0x40000000000000,K3=.3333333333333333,fn=1048575,Z3=2146435072,$3=1048576,Y3=1072693248;function Q3(r){var e,i,t,u,s,f,v,l,o,n,p,I;return r===0?B3:U3(r)||r<0?NaN:(i=on(r),s=0,i<$3&&(s-=54,r*=V3,i=on(r)),i>=Z3?r+r:(s+=(i>>20)-M3|0,i&=fn,l=i+614244&1048576|0,r=D3(r,i|l^Y3),s+=l>>20|0,v=r-1,(fn&2+i)<3?v===0?s===0?0:s*Or+s*Sr:(f=v*v*(.5-K3*v),s===0?v-f:s*Or-(f-s*Sr-v)):(n=v/(2+v),I=n*n,l=i-398458|0,p=I*I,o=440401-i|0,u=p*C3(p),t=I*X3(p),l|=o,f=t+u,l>0?(e=.5*v*v,s===0?v-(e-n*(e+f)):s*Or-(e-(n*(e+f)+s*Sr)-v)):s===0?v-n*(v-f):s*Or-(n*(v-f)-s*Sr-v))))}cn.exports=Q3});var qn=a((Y5,ln)=>{"use strict";var k3=pn();ln.exports=k3});var In=a((Q5,_n)=>{"use strict";var z3=ir();function J3(r){return z3(r)===r}_n.exports=J3});var _e=a((k5,An)=>{"use strict";var j3=In();An.exports=j3});var Nn=a((z5,En)=>{"use strict";var rp=_e();function ep(r){return rp(r/2)}En.exports=ep});var dn=a((J5,gn)=>{"use strict";var tp=Nn();gn.exports=tp});var mn=a((j5,Sn)=>{"use strict";var On=dn();function ip(r){return r>0?On(r-1):On(r+1)}Sn.exports=ip});var Ie=a((r8,Hn)=>{"use strict";var ap=mn();Hn.exports=ap});var Fn=a((e8,hn)=>{"use strict";function sp(r){return r|0}hn.exports=sp});var Ae=a((t8,xn)=>{"use strict";var up=Fn();xn.exports=up});var wn=a((i8,Pn)=>{"use strict";var Tn=Ie(),np=nr(),vp=x(),mr=S();function op(r,e){return e===vp?mr:e===mr?0:e>0?Tn(e)?r:0:Tn(e)?np(mr,r):mr}Pn.exports=op});var Wn=a((a8,yn)=>{"use strict";var fp=m(),cp=g(),pp=1072693247,Hr=1e300,hr=1e-300;function lp(r,e){var i,t;return t=cp(r),i=t&fp,i<=pp?e<0?Hr*Hr:hr*hr:e>0?Hr*Hr:hr*hr}yn.exports=lp});var Ln=a((s8,Gn)=>{"use strict";var qp=vr(),bn=S();function _p(r,e){return r===-1?(r-r)/(r-r):r===1?1:qp(r)<1==(e===bn)?0:bn}Gn.exports=_p});var Ee=a((u8,Rn)=>{"use strict";var Ip=20;Rn.exports=Ip});var Un=a((n8,Dn)=>{"use strict";function Ap(r){return r===0?.5999999999999946:.5999999999999946+r*(.4285714285785502+r*(.33333332981837743+r*(.272728123808534+r*(.23066074577556175+r*.20697501780033842))))}Dn.exports=Ap});var Xn=a((v8,Cn)=>{"use strict";var Ep=g(),Fr=Z(),Mn=dr(),Np=X(),gp=Ee(),dp=Un(),Op=1048575,Bn=1048576,Sp=1072693248,mp=536870912,Hp=524288,hp=9007199254740992,Fp=.9617966939259756,xp=.9617967009544373,Tp=-7028461650952758e-24,Pp=[1,1.5],wp=[0,.5849624872207642],yp=[0,1350039202129749e-23];function Wp(r,e,i){var t,u,s,f,v,l,o,n,p,I,c,A,N,q,_,xr,rr,M,B,$,er,b;return $=0,i<Bn&&(e*=hp,$-=53,i=Ep(e)),$+=(i>>gp)-Np|0,er=i&Op|0,i=er|Sp|0,er<=235662?b=0:er<767610?b=1:(b=0,$+=1,i-=Bn),e=Mn(e,i),n=Pp[b],M=e-n,B=1/(e+n),u=M*B,f=Fr(u,0),t=(i>>1|mp)+Hp,t+=b<<18,l=Mn(0,t),o=e-(l-n),v=B*(M-f*l-f*o),s=u*u,rr=s*s*dp(s),rr+=v*(f+u),s=f*f,l=3+s+rr,l=Fr(l,0),o=rr-(l-3-s),M=f*l,B=v*l+o*u,I=M+B,I=Fr(I,0),c=B-(I-M),A=xp*I,N=Tp*I+c*Fp+yp[b],p=wp[b],xr=$,q=A+N+p+xr,q=Fr(q,0),_=N-(q-xr-p-A),r[0]=q,r[1]=_,r}Cn.exports=Wp});var Kn=a((o8,Vn)=>{"use strict";function bp(r){return r===0?.5:.5+r*(-.3333333333333333+r*.25)}Vn.exports=bp});var $n=a((f8,Zn)=>{"use strict";var Gp=Z(),Lp=Kn(),Rp=1.4426950408889634,Dp=1.4426950216293335,Up=19259629911266175e-24;function Mp(r,e){var i,t,u,s,f,v;return u=e-1,s=u*u*Lp(u),f=Dp*u,v=u*Up-s*Rp,t=f+v,t=Gp(t,0),i=v-(t-f),r[0]=t,r[1]=i,r}Zn.exports=Mp});var Qn=a((c8,Yn)=>{"use strict";var Bp=.6931471805599453;Yn.exports=Bp});var zn=a((p8,kn)=>{"use strict";function Cp(r){return r===0?.16666666666666602:.16666666666666602+r*(-.0027777777777015593+r*(6613756321437934e-20+r*(-16533902205465252e-22+r*41381367970572385e-24)))}kn.exports=Cp});var av=a((l8,iv)=>{"use strict";var Xp=g(),Jn=dr(),Vp=Z(),Kp=Ae(),Zp=or(),$p=Qn(),jn=X(),rv=m(),ev=Cr(),j=Ee(),Yp=zn(),tv=1048576,Qp=1071644672,kp=.6931471824645996,zp=-1904654299957768e-24;function Jp(r,e,i){var t,u,s,f,v,l,o,n,p,I,c;return I=r&rv|0,c=(I>>j)-jn|0,p=0,I>Qp&&(p=r+(tv>>c+1)>>>0,c=((p&rv)>>j)-jn|0,t=(p&~(ev>>c))>>>0,s=Jn(0,t),p=(p&ev|tv)>>j-c>>>0,r<0&&(p=-p),e-=s),s=i+e,s=Vp(s,0),v=s*kp,l=(i-(s-e))*$p+s*zp,n=v+l,o=l-(n-v),s=n*n,u=n-s*Yp(s),f=n*u/(u-2)-(o+n*o),n=1-(f-n),r=Xp(n),r=Kp(r),r+=p<<j>>>0,r>>j<=0?n=Zp(n,p):n=Jn(n,r),n}iv.exports=Jp});var _v=a((q8,qv)=>{"use strict";var sv=O(),uv=Ie(),nv=V(),jp=_e(),vv=J(),rl=vr(),Ne=ur(),el=Z(),ov=Ae(),tl=x(),il=S(),ge=m(),al=wn(),sl=Wn(),ul=Ln(),nl=Xn(),vl=$n(),ol=av(),fl=1072693247,cl=1105199104,pl=1139802112,fv=1083179008,ll=1072693248,ql=1083231232,_l=3230714880,cv=31,y=1e300,W=1e-300,Il=8008566259537294e-32,F=[0,0],pv=[0,0];function lv(r,e){var i,t,u,s,f,v,l,o,n,p,I,c,A,N,q,_;if(sv(r)||sv(e))return NaN;if(Ne.assign(e,F,1,0),v=F[0],l=F[1],l===0){if(e===0)return 1;if(e===1)return r;if(e===-1)return 1/r;if(e===.5)return vv(r);if(e===-.5)return 1/vv(r);if(e===2)return r*r;if(e===3)return r*r*r;if(e===4)return r*=r,r*r;if(nv(e))return ul(r,e)}if(Ne.assign(r,F,1,0),s=F[0],f=F[1],f===0){if(s===0)return al(r,e);if(r===1)return 1;if(r===-1&&uv(e))return-1;if(nv(r))return r===tl?lv(-0,-e):e<0?0:il}if(r<0&&jp(e)===!1)return(r-r)/(r-r);if(u=rl(r),i=s&ge|0,t=v&ge|0,o=s>>>cv|0,n=v>>>cv|0,o&&uv(e)?o=-1:o=1,t>cl){if(t>pl)return sl(r,e);if(i<fl)return n===1?o*y*y:o*W*W;if(i>ll)return n===0?o*y*y:o*W*W;A=vl(pv,u)}else A=nl(pv,u,i);if(p=el(e,0),c=(e-p)*A[0]+e*A[1],I=p*A[0],N=c+I,Ne.assign(N,F,1,0),q=ov(F[0]),_=ov(F[1]),q>=fv){if((q-fv|_)!==0||c+Il>N-I)return o*y*y}else if((q&ge)>=ql&&((q-_l|_)!==0||c<=N-I))return o*W*W;return N=ol(q,I,c),o*N}qv.exports=lv});var Av=a((_8,Iv)=>{"use strict";var Al=_v();Iv.exports=Al});var dv=a((I8,gv)=>{"use strict";var Ev=O(),Nv=V(),El=S(),Nl=J();function gl(r,e){var i;return Nv(r)||Nv(e)?El:Ev(r)||Ev(e)?NaN:(r<0&&(r=-r),e<0&&(e=-e),r<e&&(i=e,e=r,r=i),r===0?0:(e/=r,r*Nl(1+e*e)))}gv.exports=gl});var Sv=a((A8,Ov)=>{"use strict";var dl=dv();Ov.exports=dl});var Ol=d(Ss(),1),Sl=d(xs(),1),ml=d($s(),1),Hl=d(ce(),1),hl=d(_u(),1),Fl=d(pe(),1),xl=d(yu(),1),Tl=d(Ju(),1),Pl=d(qn(),1),wl=d(Av(),1),yl=d(Sv(),1);var export_acos=xl.default;var export_asin=Fl.default;var export_atan=Hl.default;var export_atan2=hl.default;var export_cos=Sl.default;var export_exp=Tl.default;var export_hypot=yl.default;var export_log=Pl.default;var export_pow=wl.default;var export_sin=Ol.default;var export_tan=ml.default;export{export_acos as acos,export_asin as asin,export_atan as atan,export_atan2 as atan2,export_cos as cos,export_exp as exp,export_hypot as hypot,export_log as log,export_pow as pow,export_sin as sin,export_tan as tan};
/*! Bundled license information:

@stdlib/constants-float64-high-word-abs-mask/lib/index.js:
@stdlib/math-base-special-kernel-cos/lib/polyval_c13.js:
@stdlib/math-base-special-kernel-cos/lib/polyval_c46.js:
@stdlib/constants-float64-high-word-sign-mask/lib/index.js:
@stdlib/string-base-format-interpolate/lib/is_number.js:
@stdlib/string-base-format-interpolate/lib/zero_pad.js:
@stdlib/string-base-format-interpolate/lib/format_integer.js:
@stdlib/string-base-format-interpolate/lib/is_string.js:
@stdlib/string-base-format-interpolate/lib/format_double.js:
@stdlib/string-base-format-interpolate/lib/space_pad.js:
@stdlib/string-base-format-interpolate/lib/main.js:
@stdlib/string-base-format-interpolate/lib/index.js:
@stdlib/string-base-format-tokenize/lib/main.js:
@stdlib/string-base-format-tokenize/lib/index.js:
@stdlib/string-format/lib/is_string.js:
@stdlib/string-format/lib/main.js:
@stdlib/string-format/lib/index.js:
@stdlib/math-base-special-kernel-tan/lib/polyval_t_odd.js:
@stdlib/math-base-special-kernel-tan/lib/polyval_t_even.js:
@stdlib/math-base-special-atan/lib/polyval_p.js:
@stdlib/math-base-special-atan/lib/polyval_q.js:
@stdlib/math-base-special-asin/lib/rational_pq.js:
@stdlib/math-base-special-asin/lib/rational_rs.js:
@stdlib/math-base-special-exp/lib/polyval_p.js:
@stdlib/math-base-special-ln/lib/polyval_p.js:
@stdlib/math-base-special-ln/lib/polyval_q.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2022 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *)

@stdlib/constants-float64-high-word-exponent-mask/lib/index.js:
@stdlib/assert-has-symbol-support/lib/main.js:
@stdlib/assert-has-symbol-support/lib/index.js:
@stdlib/assert-has-tostringtag-support/lib/main.js:
@stdlib/assert-has-tostringtag-support/lib/index.js:
@stdlib/utils-native-class/lib/tostring.js:
@stdlib/utils-native-class/lib/main.js:
@stdlib/assert-has-own-property/lib/main.js:
@stdlib/assert-has-own-property/lib/index.js:
@stdlib/symbol-ctor/lib/main.js:
@stdlib/symbol-ctor/lib/index.js:
@stdlib/utils-native-class/lib/tostringtag.js:
@stdlib/utils-native-class/lib/polyfill.js:
@stdlib/utils-native-class/lib/index.js:
@stdlib/assert-is-uint32array/lib/main.js:
@stdlib/assert-is-uint32array/lib/index.js:
@stdlib/constants-uint32-max/lib/index.js:
@stdlib/assert-has-uint32array-support/lib/uint32array.js:
@stdlib/assert-has-uint32array-support/lib/main.js:
@stdlib/assert-has-uint32array-support/lib/index.js:
@stdlib/array-uint32/lib/main.js:
@stdlib/array-uint32/lib/polyfill.js:
@stdlib/array-uint32/lib/index.js:
@stdlib/assert-is-float64array/lib/main.js:
@stdlib/assert-is-float64array/lib/index.js:
@stdlib/assert-has-float64array-support/lib/float64array.js:
@stdlib/assert-has-float64array-support/lib/main.js:
@stdlib/assert-has-float64array-support/lib/index.js:
@stdlib/array-float64/lib/main.js:
@stdlib/array-float64/lib/polyfill.js:
@stdlib/array-float64/lib/index.js:
@stdlib/assert-is-uint8array/lib/main.js:
@stdlib/assert-is-uint8array/lib/index.js:
@stdlib/constants-uint8-max/lib/index.js:
@stdlib/assert-has-uint8array-support/lib/uint8array.js:
@stdlib/assert-has-uint8array-support/lib/main.js:
@stdlib/assert-has-uint8array-support/lib/index.js:
@stdlib/array-uint8/lib/main.js:
@stdlib/array-uint8/lib/polyfill.js:
@stdlib/array-uint8/lib/index.js:
@stdlib/assert-is-uint16array/lib/main.js:
@stdlib/assert-is-uint16array/lib/index.js:
@stdlib/constants-uint16-max/lib/index.js:
@stdlib/assert-has-uint16array-support/lib/uint16array.js:
@stdlib/assert-has-uint16array-support/lib/main.js:
@stdlib/assert-has-uint16array-support/lib/index.js:
@stdlib/array-uint16/lib/main.js:
@stdlib/array-uint16/lib/polyfill.js:
@stdlib/array-uint16/lib/index.js:
@stdlib/assert-is-little-endian/lib/ctors.js:
@stdlib/assert-is-little-endian/lib/main.js:
@stdlib/assert-is-little-endian/lib/index.js:
@stdlib/number-float64-base-get-high-word/lib/high.js:
@stdlib/number-float64-base-get-high-word/lib/main.js:
@stdlib/number-float64-base-get-high-word/lib/index.js:
@stdlib/math-base-special-kernel-cos/lib/index.js:
@stdlib/math-base-special-kernel-sin/lib/index.js:
@stdlib/constants-float64-high-word-significand-mask/lib/index.js:
@stdlib/number-float64-base-get-low-word/lib/low.js:
@stdlib/number-float64-base-get-low-word/lib/main.js:
@stdlib/number-float64-base-get-low-word/lib/index.js:
@stdlib/number-float64-base-from-words/lib/indices.js:
@stdlib/number-float64-base-from-words/lib/main.js:
@stdlib/number-float64-base-from-words/lib/index.js:
@stdlib/math-base-special-floor/lib/main.js:
@stdlib/math-base-special-floor/lib/index.js:
@stdlib/constants-float64-pinf/lib/index.js:
@stdlib/number-ctor/lib/main.js:
@stdlib/number-ctor/lib/index.js:
@stdlib/constants-float64-ninf/lib/index.js:
@stdlib/constants-float64-exponent-bias/lib/index.js:
@stdlib/constants-float64-max-base2-exponent/lib/index.js:
@stdlib/constants-float64-max-base2-exponent-subnormal/lib/index.js:
@stdlib/constants-float64-min-base2-exponent-subnormal/lib/index.js:
@stdlib/math-base-assert-is-nan/lib/main.js:
@stdlib/math-base-assert-is-nan/lib/index.js:
@stdlib/math-base-assert-is-infinite/lib/main.js:
@stdlib/math-base-assert-is-infinite/lib/index.js:
@stdlib/utils-define-property/lib/builtin.js:
@stdlib/utils-define-property/lib/polyfill.js:
@stdlib/utils-define-property/lib/index.js:
@stdlib/utils-define-nonenumerable-read-only-property/lib/main.js:
@stdlib/utils-define-nonenumerable-read-only-property/lib/index.js:
@stdlib/number-float64-base-to-words/lib/indices.js:
@stdlib/number-float64-base-to-words/lib/assign.js:
@stdlib/number-float64-base-to-words/lib/main.js:
@stdlib/number-float64-base-to-words/lib/index.js:
@stdlib/math-base-special-copysign/lib/main.js:
@stdlib/math-base-special-copysign/lib/index.js:
@stdlib/constants-float64-smallest-normal/lib/index.js:
@stdlib/math-base-special-abs/lib/index.js:
@stdlib/number-float64-base-normalize/lib/assign.js:
@stdlib/number-float64-base-normalize/lib/main.js:
@stdlib/number-float64-base-normalize/lib/index.js:
@stdlib/number-float64-base-exponent/lib/main.js:
@stdlib/number-float64-base-exponent/lib/index.js:
@stdlib/math-base-special-ldexp/lib/main.js:
@stdlib/math-base-special-ldexp/lib/index.js:
@stdlib/math-base-special-round/lib/main.js:
@stdlib/math-base-special-round/lib/index.js:
@stdlib/math-base-special-rempio2/lib/index.js:
@stdlib/math-base-special-sin/lib/index.js:
@stdlib/math-base-special-cos/lib/index.js:
@stdlib/number-float64-base-set-low-word/lib/low.js:
@stdlib/number-float64-base-set-low-word/lib/main.js:
@stdlib/number-float64-base-set-low-word/lib/index.js:
@stdlib/math-base-special-kernel-tan/lib/index.js:
@stdlib/math-base-special-tan/lib/index.js:
@stdlib/constants-float64-half-pi/lib/index.js:
@stdlib/constants-float64-fourth-pi/lib/index.js:
@stdlib/math-base-special-atan/lib/index.js:
@stdlib/number-float64-base-signbit/lib/main.js:
@stdlib/number-float64-base-signbit/lib/index.js:
@stdlib/constants-float64-pi/lib/index.js:
@stdlib/math-base-special-atan2/lib/index.js:
@stdlib/math-base-special-sqrt/lib/main.js:
@stdlib/math-base-special-sqrt/lib/index.js:
@stdlib/math-base-special-asin/lib/index.js:
@stdlib/math-base-special-acos/lib/index.js:
@stdlib/math-base-special-ceil/lib/main.js:
@stdlib/math-base-special-ceil/lib/index.js:
@stdlib/math-base-special-trunc/lib/main.js:
@stdlib/math-base-special-trunc/lib/index.js:
@stdlib/math-base-special-exp/lib/index.js:
@stdlib/number-float64-base-set-high-word/lib/high.js:
@stdlib/number-float64-base-set-high-word/lib/main.js:
@stdlib/number-float64-base-set-high-word/lib/index.js:
@stdlib/math-base-special-ln/lib/index.js:
@stdlib/math-base-assert-is-integer/lib/main.js:
@stdlib/math-base-assert-is-integer/lib/index.js:
@stdlib/math-base-assert-is-even/lib/main.js:
@stdlib/math-base-assert-is-even/lib/index.js:
@stdlib/math-base-assert-is-odd/lib/main.js:
@stdlib/math-base-assert-is-odd/lib/index.js:
@stdlib/number-uint32-base-to-int32/lib/main.js:
@stdlib/number-uint32-base-to-int32/lib/index.js:
@stdlib/math-base-special-pow/lib/y_is_infinite.js:
@stdlib/constants-float64-ln-two/lib/index.js:
@stdlib/math-base-special-pow/lib/index.js:
@stdlib/math-base-special-hypot/lib/main.js:
@stdlib/math-base-special-hypot/lib/index.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *)

@stdlib/math-base-special-kernel-cos/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/12.2.0/lib/msun/src/k_cos.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-kernel-sin/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/k_sin.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/utils-define-property/lib/define_property.js:
@stdlib/utils-define-property/lib/has_define_property_support.js:
@stdlib/math-base-special-abs/lib/main.js:
@stdlib/array-base-filled/lib/main.js:
@stdlib/array-base-filled/lib/index.js:
@stdlib/array-base-zeros/lib/main.js:
@stdlib/array-base-zeros/lib/index.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2021 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *)

@stdlib/math-base-special-rempio2/lib/kernel_rempio2.js:
@stdlib/math-base-special-rempio2/lib/rempio2_medium.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright and license were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/k_rem_pio2.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-rempio2/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright and license were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/e_rem_pio2.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  *
  * Optimized by Bruce D. Evans.
  * ```
  *)

@stdlib/math-base-special-sin/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/s_sin.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-cos/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/s_cos.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-kernel-tan/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/12.2.0/lib/msun/src/k_tan.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-tan/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright, license, and long comment were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/s_tan.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-atan/lib/main.js:
@stdlib/math-base-special-asin/lib/main.js:
@stdlib/math-base-special-acos/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The original C code, long comment, copyright, license, and constants are from [Cephes]{@link http://www.netlib.org/cephes}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright 1984, 1995, 2000 by Stephen L. Moshier
  *
  * Some software in this archive may be from the book _Methods and Programs for Mathematical Functions_ (Prentice-Hall or Simon & Schuster International, 1989) or from the Cephes Mathematical Library, a commercial product. In either event, it is copyrighted by the author. What you see here may be used freely but it comes with no support or guarantee.
  *
  * Stephen L. Moshier
  * moshier@na-net.ornl.gov
  * ```
  *)

@stdlib/math-base-special-atan2/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The original code, copyright and license are from [Go]{@link https://golang.org/src/math/atan2.go}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (c) 2009 The Go Authors. All rights reserved.
  *
  * Redistribution and use in source and binary forms, with or without
  * modification, are permitted provided that the following conditions are
  * met:
  *
  *    * Redistributions of source code must retain the above copyright
  * notice, this list of conditions and the following disclaimer.
  *    * Redistributions in binary form must reproduce the above
  * copyright notice, this list of conditions and the following disclaimer
  * in the documentation and/or other materials provided with the
  * distribution.
  *    * Neither the name of Google Inc. nor the names of its
  * contributors may be used to endorse or promote products derived from
  * this software without specific prior written permission.
  *
  * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  * ```
  *)

@stdlib/math-base-special-exp/lib/expmulti.js:
@stdlib/math-base-special-exp/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyrights, licenses, and long comment were part of the original implementation available as part of [Go]{@link https://github.com/golang/go/blob/cb07765045aed5104a3df31507564ac99e6ddce8/src/math/exp.go}, which in turn was based on an implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/e_exp.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (c) 2009 The Go Authors. All rights reserved.
  *
  * Redistribution and use in source and binary forms, with or without
  * modification, are permitted provided that the following conditions are
  * met:
  *
  *    * Redistributions of source code must retain the above copyright
  * notice, this list of conditions and the following disclaimer.
  *    * Redistributions in binary form must reproduce the above
  * copyright notice, this list of conditions and the following disclaimer
  * in the documentation and/or other materials provided with the
  * distribution.
  *    * Neither the name of Google Inc. nor the names of its
  * contributors may be used to endorse or promote products derived from
  * this software without specific prior written permission.
  *
  * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  * ```
  *
  * ```text
  * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-ln/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright and license were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/e_log.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/math-base-special-pow/lib/x_is_zero.js:
@stdlib/math-base-special-pow/lib/y_is_huge.js:
@stdlib/math-base-special-pow/lib/log2ax.js:
@stdlib/math-base-special-pow/lib/logx.js:
@stdlib/math-base-special-pow/lib/pow2.js:
@stdlib/math-base-special-pow/lib/main.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2018 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *
  *
  * ## Notice
  *
  * The following copyright and license were part of the original implementation available as part of [FreeBSD]{@link https://svnweb.freebsd.org/base/release/9.3.0/lib/msun/src/s_pow.c}. The implementation follows the original, but has been modified for JavaScript.
  *
  * ```text
  * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
  *
  * Developed at SunPro, a Sun Microsystems, Inc. business.
  * Permission to use, copy, modify, and distribute this
  * software is freely granted, provided that this notice
  * is preserved.
  * ```
  *)

@stdlib/constants-float64-num-high-word-significand-bits/lib/index.js:
@stdlib/math-base-special-pow/lib/polyval_l.js:
@stdlib/math-base-special-pow/lib/polyval_w.js:
@stdlib/math-base-special-pow/lib/polyval_p.js:
  (**
  * @license Apache-2.0
  *
  * Copyright (c) 2024 The Stdlib Authors.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *    http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  *)
*/
