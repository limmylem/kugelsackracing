// stdlib (Apache-2.0, https://github.com/stdlib-js/stdlib): @stdlib/math-base-special-* — sin 0.3.1, cos 0.3.1, tan 0.3.1, atan 0.2.4, atan2 0.3.1, asin 0.2.4, acos 0.2.4, exp 0.2.5, log 0.2.4, pow 0.3.1, hypot 0.2.4. Built by tools/build-detmath.mjs.
var Tv=Object.create;var de=Object.defineProperty;var Pv=Object.getOwnPropertyDescriptor;var wv=Object.getOwnPropertyNames;var yv=Object.getPrototypeOf,Wv=Object.prototype.hasOwnProperty;var a=(r,e)=>()=>{try{return e||r((e={exports:{}}).exports,e),e.exports}catch(i){throw e=0,i}};var bv=(r,e,i,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let u of wv(e))!Wv.call(r,u)&&u!==i&&de(r,u,{get:()=>e[u],enumerable:!(t=Pv(e,u))||t.enumerable});return r};var d=(r,e,i)=>(i=r!=null?Tv(yv(r)):{},bv(e||!r||!r.__esModule?de(i,"default",{value:r,enumerable:!0}):i,r));var m=a((Bl,Oe)=>{"use strict";var Gv=2147483647;Oe.exports=Gv});var C=a((Cl,Se)=>{"use strict";var Lv=2146435072;Se.exports=Lv});var He=a((Xl,me)=>{"use strict";function Rv(){return typeof Symbol=="function"&&typeof Symbol("foo")=="symbol"}me.exports=Rv});var Fe=a((Vl,he)=>{"use strict";var Dv=He();he.exports=Dv});var Te=a((Kl,xe)=>{"use strict";var Uv=Fe(),Mv=Uv();function Bv(){return Mv&&typeof Symbol.toStringTag=="symbol"}xe.exports=Bv});var we=a((Zl,Pe)=>{"use strict";var Cv=Te();Pe.exports=Cv});var Tr=a(($l,ye)=>{"use strict";var Xv=Object.prototype.toString;ye.exports=Xv});var be=a((Yl,We)=>{"use strict";var Vv=Tr();function Kv(r){return Vv.call(r)}We.exports=Kv});var Le=a((Ql,Ge)=>{"use strict";var Zv=Object.prototype.hasOwnProperty;function $v(r,e){return r==null?!1:Zv.call(r,e)}Ge.exports=$v});var De=a((kl,Re)=>{"use strict";var Yv=Le();Re.exports=Yv});var Me=a((zl,Ue)=>{"use strict";var Qv=typeof Symbol=="function"?Symbol:void 0;Ue.exports=Qv});var Ce=a((Jl,Be)=>{"use strict";var kv=Me();Be.exports=kv});var Ke=a((jl,Ve)=>{"use strict";var Xe=Ce(),zv=typeof Xe=="function"?Xe.toStringTag:"";Ve.exports=zv});var $e=a((r4,Ze)=>{"use strict";var Jv=De(),Y=Ke(),Pr=Tr();function jv(r){var e,i,t;if(r==null)return Pr.call(r);i=r[Y],e=Jv(r,Y);try{r[Y]=void 0}catch{return Pr.call(r)}return t=Pr.call(r),e?r[Y]=i:delete r[Y],t}Ze.exports=jv});var Q=a((e4,Ye)=>{"use strict";var ro=we(),eo=be(),to=$e(),wr;ro()?wr=to:wr=eo;Ye.exports=wr});var ke=a((t4,Qe)=>{"use strict";var io=Q(),ao=typeof Uint32Array=="function";function so(r){return ao&&r instanceof Uint32Array||io(r)==="[object Uint32Array]"}Qe.exports=so});var Je=a((i4,ze)=>{"use strict";var uo=ke();ze.exports=uo});var rt=a((a4,je)=>{"use strict";var no=4294967295;je.exports=no});var tt=a((s4,et)=>{"use strict";var vo=typeof Uint32Array=="function"?Uint32Array:null;et.exports=vo});var st=a((u4,at)=>{"use strict";var oo=Je(),yr=rt(),it=tt();function fo(){var r,e;if(typeof it!="function")return!1;try{e=[1,3.14,-3.14,yr+1,yr+2],e=new it(e),r=oo(e)&&e[0]===1&&e[1]===3&&e[2]===yr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}at.exports=fo});var nt=a((n4,ut)=>{"use strict";var co=st();ut.exports=co});var ot=a((v4,vt)=>{"use strict";var po=typeof Uint32Array=="function"?Uint32Array:void 0;vt.exports=po});var ct=a((o4,ft)=>{"use strict";function lo(){throw new Error("not implemented")}ft.exports=lo});var G=a((f4,pt)=>{"use strict";var qo=nt(),_o=ot(),Io=ct(),Wr;qo()?Wr=_o:Wr=Io;pt.exports=Wr});var qt=a((c4,lt)=>{"use strict";var Ao=Q(),Eo=typeof Float64Array=="function";function No(r){return Eo&&r instanceof Float64Array||Ao(r)==="[object Float64Array]"}lt.exports=No});var It=a((p4,_t)=>{"use strict";var go=qt();_t.exports=go});var Et=a((l4,At)=>{"use strict";var Oo=typeof Float64Array=="function"?Float64Array:null;At.exports=Oo});var dt=a((q4,gt)=>{"use strict";var So=It(),Nt=Et();function mo(){var r,e;if(typeof Nt!="function")return!1;try{e=new Nt([1,3.14,-3.14,NaN]),r=So(e)&&e[0]===1&&e[1]===3.14&&e[2]===-3.14&&e[3]!==e[3]}catch{r=!1}return r}gt.exports=mo});var St=a((_4,Ot)=>{"use strict";var Ho=dt();Ot.exports=Ho});var Ht=a((I4,mt)=>{"use strict";var ho=typeof Float64Array=="function"?Float64Array:void 0;mt.exports=ho});var Ft=a((A4,ht)=>{"use strict";function Fo(){throw new Error("not implemented")}ht.exports=Fo});var L=a((E4,xt)=>{"use strict";var xo=St(),To=Ht(),Po=Ft(),br;xo()?br=To:br=Po;xt.exports=br});var Pt=a((N4,Tt)=>{"use strict";var wo=Q(),yo=typeof Uint8Array=="function";function Wo(r){return yo&&r instanceof Uint8Array||wo(r)==="[object Uint8Array]"}Tt.exports=Wo});var yt=a((g4,wt)=>{"use strict";var bo=Pt();wt.exports=bo});var bt=a((d4,Wt)=>{"use strict";var Go=255;Wt.exports=Go});var Lt=a((O4,Gt)=>{"use strict";var Lo=typeof Uint8Array=="function"?Uint8Array:null;Gt.exports=Lo});var Ut=a((S4,Dt)=>{"use strict";var Ro=yt(),Gr=bt(),Rt=Lt();function Do(){var r,e;if(typeof Rt!="function")return!1;try{e=[1,3.14,-3.14,Gr+1,Gr+2],e=new Rt(e),r=Ro(e)&&e[0]===1&&e[1]===3&&e[2]===Gr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}Dt.exports=Do});var Bt=a((m4,Mt)=>{"use strict";var Uo=Ut();Mt.exports=Uo});var Xt=a((H4,Ct)=>{"use strict";var Mo=typeof Uint8Array=="function"?Uint8Array:void 0;Ct.exports=Mo});var Kt=a((h4,Vt)=>{"use strict";function Bo(){throw new Error("not implemented")}Vt.exports=Bo});var $t=a((F4,Zt)=>{"use strict";var Co=Bt(),Xo=Xt(),Vo=Kt(),Lr;Co()?Lr=Xo:Lr=Vo;Zt.exports=Lr});var Qt=a((x4,Yt)=>{"use strict";var Ko=Q(),Zo=typeof Uint16Array=="function";function $o(r){return Zo&&r instanceof Uint16Array||Ko(r)==="[object Uint16Array]"}Yt.exports=$o});var zt=a((T4,kt)=>{"use strict";var Yo=Qt();kt.exports=Yo});var jt=a((P4,Jt)=>{"use strict";var Qo=65535;Jt.exports=Qo});var ei=a((w4,ri)=>{"use strict";var ko=typeof Uint16Array=="function"?Uint16Array:null;ri.exports=ko});var ai=a((y4,ii)=>{"use strict";var zo=zt(),Rr=jt(),ti=ei();function Jo(){var r,e;if(typeof ti!="function")return!1;try{e=[1,3.14,-3.14,Rr+1,Rr+2],e=new ti(e),r=zo(e)&&e[0]===1&&e[1]===3&&e[2]===Rr-2&&e[3]===0&&e[4]===1}catch{r=!1}return r}ii.exports=Jo});var ui=a((W4,si)=>{"use strict";var jo=ai();si.exports=jo});var vi=a((b4,ni)=>{"use strict";var r1=typeof Uint16Array=="function"?Uint16Array:void 0;ni.exports=r1});var fi=a((G4,oi)=>{"use strict";function e1(){throw new Error("not implemented")}oi.exports=e1});var pi=a((L4,ci)=>{"use strict";var t1=ui(),i1=vi(),a1=fi(),Dr;t1()?Dr=i1:Dr=a1;ci.exports=Dr});var qi=a((R4,li)=>{"use strict";var s1=$t(),u1=pi(),n1={uint16:u1,uint8:s1};li.exports=n1});var Ei=a((D4,Ai)=>{"use strict";var _i=qi(),Ii;function v1(){var r,e;return r=new _i.uint16(1),r[0]=4660,e=new _i.uint8(r.buffer),e[0]===52}Ii=v1();Ai.exports=Ii});var R=a((U4,Ni)=>{"use strict";var o1=Ei();Ni.exports=o1});var di=a((M4,gi)=>{"use strict";var f1=R(),Ur;f1===!0?Ur=1:Ur=0;gi.exports=Ur});var mi=a((B4,Si)=>{"use strict";var c1=G(),p1=L(),l1=di(),Oi=new p1(1),q1=new c1(Oi.buffer);function _1(r){return Oi[0]=r,q1[l1]}Si.exports=_1});var g=a((C4,Hi)=>{"use strict";var I1=mi();Hi.exports=I1});var Fi=a((X4,hi)=>{"use strict";function A1(r){return r===0?.0416666666666666:.0416666666666666+r*(-.001388888888887411+r*2480158728947673e-20)}hi.exports=A1});var Ti=a((V4,xi)=>{"use strict";function E1(r){return r===0?-27557314351390663e-23:-27557314351390663e-23+r*(2087572321298175e-24+r*-11359647557788195e-27)}xi.exports=E1});var wi=a((K4,Pi)=>{"use strict";var N1=Fi(),g1=Ti();function d1(r,e){var i,t,u,s;return s=r*r,u=s*s,t=s*N1(s),t+=u*u*g1(s),i=.5*s,u=1-i,u+(1-u-i+(s*t-r*e))}Pi.exports=d1});var Mr=a((Z4,yi)=>{"use strict";var O1=wi();yi.exports=O1});var Gi=a(($4,bi)=>{"use strict";var Wi=-.16666666666666632,S1=.00833333333332249,m1=-.0001984126982985795,H1=27557313707070068e-22,h1=-25050760253406863e-24,F1=158969099521155e-24;function x1(r,e){var i,t,u,s;return s=r*r,u=s*s,i=S1+s*(m1+s*H1)+s*u*(h1+s*F1),t=s*r,e===0?r+t*(Wi+s*i):r-(s*(.5*e-t*i)-e-t*Wi)}bi.exports=x1});var Br=a((Y4,Li)=>{"use strict";var T1=Gi();Li.exports=T1});var Cr=a((Q4,Ri)=>{"use strict";var P1=1048575;Ri.exports=P1});var Ui=a((k4,Di)=>{"use strict";var w1=R(),Xr;w1===!0?Xr=0:Xr=1;Di.exports=Xr});var Ci=a((z4,Bi)=>{"use strict";var y1=G(),W1=L(),b1=Ui(),Mi=new W1(1),G1=new y1(Mi.buffer);function L1(r){return Mi[0]=r,G1[b1]}Bi.exports=L1});var Vi=a((J4,Xi)=>{"use strict";var R1=Ci();Xi.exports=R1});var $i=a((j4,Zi)=>{"use strict";var D1=R(),Ki,Vr,Kr;D1===!0?(Vr=1,Kr=0):(Vr=0,Kr=1);Ki={HIGH:Vr,LOW:Kr};Zi.exports=Ki});var Ji=a((r9,zi)=>{"use strict";var U1=G(),M1=L(),Qi=$i(),ki=new M1(1),Yi=new U1(ki.buffer),B1=Qi.HIGH,C1=Qi.LOW;function X1(r,e){return Yi[B1]=r,Yi[C1]=e,ki[0]}zi.exports=X1});var tr=a((e9,ji)=>{"use strict";var V1=Ji();ji.exports=V1});var e0=a((t9,r0)=>{"use strict";var K1=Math.floor;r0.exports=K1});var ir=a((i9,t0)=>{"use strict";var Z1=e0();t0.exports=Z1});var S=a((a9,i0)=>{"use strict";var $1=Number.POSITIVE_INFINITY;i0.exports=$1});var s0=a((s9,a0)=>{"use strict";a0.exports=Number});var n0=a((u9,u0)=>{"use strict";var Y1=s0();u0.exports=Y1});var x=a((n9,v0)=>{"use strict";var Q1=n0(),k1=Q1.NEGATIVE_INFINITY;v0.exports=k1});var X=a((v9,o0)=>{"use strict";var z1=1023;o0.exports=z1});var c0=a((o9,f0)=>{"use strict";var J1=1023;f0.exports=J1});var l0=a((f9,p0)=>{"use strict";var j1=-1023;p0.exports=j1});var _0=a((c9,q0)=>{"use strict";var rf=-1074;q0.exports=rf});var A0=a((p9,I0)=>{"use strict";function ef(r){return r!==r}I0.exports=ef});var O=a((l9,E0)=>{"use strict";var tf=A0();E0.exports=tf});var g0=a((q9,N0)=>{"use strict";var af=S(),sf=x();function uf(r){return r===af||r===sf}N0.exports=uf});var V=a((_9,d0)=>{"use strict";var nf=g0();d0.exports=nf});var S0=a((I9,O0)=>{"use strict";var vf=2147483648;O0.exports=vf});var H0=a((A9,m0)=>{"use strict";var of=typeof Object.defineProperty=="function"?Object.defineProperty:null;m0.exports=of});var F0=a((E9,h0)=>{"use strict";var ff=H0();function cf(){try{return ff({},"x",{}),!0}catch{return!1}}h0.exports=cf});var T0=a((N9,x0)=>{"use strict";var pf=Object.defineProperty;x0.exports=pf});var Zr=a((g9,P0)=>{"use strict";function lf(r){return typeof r=="number"}P0.exports=lf});var $r=a((d9,y0)=>{"use strict";function qf(r){return r[0]==="-"}function w0(r){var e="",i;for(i=0;i<r;i++)e+="0";return e}function _f(r,e,i){var t=!1,u=e-r.length;return u<0||(qf(r)&&(t=!0,r=r.substr(1)),r=i?r+w0(u):w0(u)+r,t&&(r="-"+r)),r}y0.exports=_f});var L0=a((O9,G0)=>{"use strict";var If=Zr(),W0=$r(),Af=String.prototype.toLowerCase,b0=String.prototype.toUpperCase;function Ef(r){var e,i,t;switch(r.specifier){case"b":e=2;break;case"o":e=8;break;case"x":case"X":e=16;break;default:e=10;break}if(i=r.arg,t=parseInt(i,10),!isFinite(t)){if(!If(i))throw new Error("invalid integer. Value: "+i);t=0}return t<0&&(r.specifier==="u"||e!==10)&&(t=4294967295+t+1),t<0?(i=(-t).toString(e),r.precision&&(i=W0(i,r.precision,r.padRight)),i="-"+i):(i=t.toString(e),!t&&!r.precision?i="":r.precision&&(i=W0(i,r.precision,r.padRight)),r.sign&&(i=r.sign+i)),e===16&&(r.alternate&&(i="0x"+i),i=r.specifier===b0.call(r.specifier)?b0.call(i):Af.call(i)),e===8&&r.alternate&&i.charAt(0)!=="0"&&(i="0"+i),i}G0.exports=Ef});var D0=a((S9,R0)=>{"use strict";function Nf(r){return typeof r=="string"}R0.exports=Nf});var B0=a((m9,M0)=>{"use strict";var gf=Math.abs,df=String.prototype.toLowerCase,U0=String.prototype.toUpperCase,D=String.prototype.replace,Of=/e\+(\d)$/,Sf=/e-(\d)$/,mf=/^(\d+)$/,Hf=/^(\d+)e/,hf=/\.0$/,Ff=/\.0*e/,xf=/(\..*[^0])0*e/;function Tf(r,e){var i,t;switch(e.specifier){case"e":case"E":t=r.toExponential(e.precision);break;case"f":case"F":t=r.toFixed(e.precision);break;case"g":case"G":gf(r)<1e-4?(i=e.precision,i>0&&(i-=1),t=r.toExponential(i)):t=r.toPrecision(e.precision),e.alternate||(t=D.call(t,xf,"$1e"),t=D.call(t,Ff,"e"),t=D.call(t,hf,""));break;default:throw new Error("invalid double notation. Value: "+e.specifier)}return t=D.call(t,Of,"e+0$1"),t=D.call(t,Sf,"e-0$1"),e.alternate&&(t=D.call(t,mf,"$1."),t=D.call(t,Hf,"$1.e")),r>=0&&e.sign&&(t=e.sign+t),t=e.specifier===U0.call(e.specifier)?U0.call(t):df.call(t),t}M0.exports=Tf});var V0=a((H9,X0)=>{"use strict";function C0(r){var e="",i;for(i=0;i<r;i++)e+=" ";return e}function Pf(r,e,i){var t=e-r.length;return t<0||(r=i?r+C0(t):C0(t)+r),r}X0.exports=Pf});var Z0=a((h9,K0)=>{"use strict";var wf=L0(),yf=D0(),Wf=Zr(),bf=B0(),Gf=V0(),Lf=$r(),Rf=String.fromCharCode,Df=Array.isArray;function ar(r){return r!==r}function Uf(r){var e={};return e.specifier=r.specifier,e.precision=r.precision===void 0?1:r.precision,e.width=r.width,e.flags=r.flags||"",e.mapping=r.mapping,e}function Mf(r){var e,i,t,u,s,f,v,l,o,n;if(!Df(r))throw new TypeError("invalid argument. First argument must be an array. Value: `"+r+"`.");for(f="",v=1,o=0;o<r.length;o++)if(t=r[o],yf(t))f+=t;else{if(e=t.precision!==void 0,t=Uf(t),!t.specifier)throw new TypeError("invalid argument. Token is missing `specifier` property. Index: `"+o+"`. Value: `"+t+"`.");for(t.mapping&&(v=t.mapping),i=t.flags,n=0;n<i.length;n++)switch(u=i.charAt(n),u){case" ":t.sign=" ";break;case"+":t.sign="+";break;case"-":t.padRight=!0,t.padZeros=!1;break;case"0":t.padZeros=i.indexOf("-")<0;break;case"#":t.alternate=!0;break;default:throw new Error("invalid flag: "+u)}if(t.width==="*"){if(t.width=parseInt(arguments[v],10),v+=1,ar(t.width))throw new TypeError("the argument for * width at position "+v+" is not a number. Value: `"+t.width+"`.");t.width<0&&(t.padRight=!0,t.width=-t.width)}if(e&&t.precision==="*"){if(t.precision=parseInt(arguments[v],10),v+=1,ar(t.precision))throw new TypeError("the argument for * precision at position "+v+" is not a number. Value: `"+t.precision+"`.");t.precision<0&&(t.precision=1,e=!1)}switch(t.arg=arguments[v],t.specifier){case"b":case"o":case"x":case"X":case"d":case"i":case"u":e&&(t.padZeros=!1),t.arg=wf(t);break;case"s":t.maxWidth=e?t.precision:-1,t.arg=String(t.arg);break;case"c":if(!ar(t.arg)){if(s=parseInt(t.arg,10),s<0||s>127)throw new Error("invalid character code. Value: "+t.arg);t.arg=ar(s)?String(t.arg):Rf(s)}break;case"e":case"E":case"f":case"F":case"g":case"G":if(e||(t.precision=6),l=parseFloat(t.arg),!isFinite(l)){if(!Wf(t.arg))throw new Error("invalid floating-point number. Value: "+f);l=t.arg,t.padZeros=!1}t.arg=bf(l,t);break;default:throw new Error("invalid specifier: "+t.specifier)}t.maxWidth>=0&&t.arg.length>t.maxWidth&&(t.arg=t.arg.substring(0,t.maxWidth)),t.padZeros?t.arg=Lf(t.arg,t.width||t.precision,t.padRight):t.width&&(t.arg=Gf(t.arg,t.width,t.padRight)),f+=t.arg||"",v+=1}return f}K0.exports=Mf});var Y0=a((F9,$0)=>{"use strict";var Bf=Z0();$0.exports=Bf});var k0=a((x9,Q0)=>{"use strict";var sr=/%(?:([1-9]\d*)\$)?([0 +\-#]*)(\*|\d+)?(?:(\.)(\*|\d+)?)?[hlL]?([%A-Za-z])/g;function Cf(r){var e={mapping:r[1]?parseInt(r[1],10):void 0,flags:r[2],width:r[3],precision:r[5],specifier:r[6]};return r[4]==="."&&r[5]===void 0&&(e.precision="1"),e}function Xf(r){var e,i,t,u;for(i=[],u=0,t=sr.exec(r);t;)e=r.slice(u,sr.lastIndex-t[0].length),e.length&&i.push(e),t[6]==="%"?i.push("%"):i.push(Cf(t)),u=sr.lastIndex,t=sr.exec(r);return e=r.slice(u),e.length&&i.push(e),i}Q0.exports=Xf});var J0=a((T9,z0)=>{"use strict";var Vf=k0();z0.exports=Vf});var ra=a((P9,j0)=>{"use strict";function Kf(r){return typeof r=="string"}j0.exports=Kf});var ia=a((w9,ta)=>{"use strict";var Zf=Y0(),$f=J0(),Yf=ra();function ea(r){var e,i;if(!Yf(r))throw new TypeError(ea("invalid argument. First argument must be a string. Value: `%s`.",r));for(e=[$f(r)],i=1;i<arguments.length;i++)e.push(arguments[i]);return Zf.apply(null,e)}ta.exports=ea});var sa=a((y9,aa)=>{"use strict";var Qf=ia();aa.exports=Qf});var ca=a((W9,fa)=>{"use strict";var ua=sa(),K=Object.prototype,na=K.toString,va=K.__defineGetter__,oa=K.__defineSetter__,kf=K.__lookupGetter__,zf=K.__lookupSetter__;function Jf(r,e,i){var t,u,s,f;if(typeof r!="object"||r===null||na.call(r)==="[object Array]")throw new TypeError(ua("invalid argument. First argument must be an object. Value: `%s`.",r));if(typeof i!="object"||i===null||na.call(i)==="[object Array]")throw new TypeError(ua("invalid argument. Property descriptor must be an object. Value: `%s`.",i));if(u="value"in i,u&&(kf.call(r,e)||zf.call(r,e)?(t=r.__proto__,r.__proto__=K,delete r[e],r[e]=i.value,r.__proto__=t):r[e]=i.value),s="get"in i,f="set"in i,u&&(s||f))throw new Error("invalid argument. Cannot specify one or more accessors and a value or writable attribute in the property descriptor.");return s&&va&&va.call(r,e,i.get),f&&oa&&oa.call(r,e,i.set),r}fa.exports=Jf});var la=a((b9,pa)=>{"use strict";var jf=F0(),r6=T0(),e6=ca(),Yr;jf()?Yr=r6:Yr=e6;pa.exports=Yr});var _a=a((G9,qa)=>{"use strict";var t6=la();function i6(r,e,i){t6(r,e,{configurable:!1,enumerable:!1,writable:!1,value:i})}qa.exports=i6});var Qr=a((L9,Ia)=>{"use strict";var a6=_a();Ia.exports=a6});var Na=a((R9,Ea)=>{"use strict";var s6=R(),Aa,kr,zr;s6===!0?(kr=1,zr=0):(kr=0,zr=1);Aa={HIGH:kr,LOW:zr};Ea.exports=Aa});var Jr=a((D9,Sa)=>{"use strict";var u6=G(),n6=L(),da=Na(),Oa=new n6(1),ga=new u6(Oa.buffer),v6=da.HIGH,o6=da.LOW;function f6(r,e,i,t){return Oa[0]=r,e[t]=ga[v6],e[t+i]=ga[o6],e}Sa.exports=f6});var Ha=a((U9,ma)=>{"use strict";var c6=Jr();function p6(r){return c6(r,[0,0],1,0)}ma.exports=p6});var ur=a((M9,Fa)=>{"use strict";var l6=Qr(),ha=Ha(),q6=Jr();l6(ha,"assign",q6);Fa.exports=ha});var Ta=a((B9,xa)=>{"use strict";var _6=S0(),I6=m(),A6=ur(),E6=g(),N6=tr(),jr=[0,0];function g6(r,e){var i,t;return A6.assign(r,jr,1,0),i=jr[0],i&=I6,t=E6(e),t&=_6,i|=t,N6(i,jr[1])}xa.exports=g6});var nr=a((C9,Pa)=>{"use strict";var d6=Ta();Pa.exports=d6});var ya=a((X9,wa)=>{"use strict";var O6=22250738585072014e-324;wa.exports=O6});var ba=a((V9,Wa)=>{"use strict";function S6(r){return Math.abs(r)}Wa.exports=S6});var vr=a((K9,Ga)=>{"use strict";var m6=ba();Ga.exports=m6});var re=a((Z9,La)=>{"use strict";var H6=ya(),h6=V(),F6=O(),x6=vr(),T6=4503599627370496;function P6(r,e,i,t){return F6(r)||h6(r)?(e[t]=r,e[t+i]=0,e):r!==0&&x6(r)<H6?(e[t]=r*T6,e[t+i]=-52,e):(e[t]=r,e[t+i]=0,e)}La.exports=P6});var Da=a(($9,Ra)=>{"use strict";var w6=re();function y6(r){return w6(r,[0,0],1,0)}Ra.exports=y6});var Ba=a((Y9,Ma)=>{"use strict";var W6=Qr(),Ua=Da(),b6=re();W6(Ua,"assign",b6);Ma.exports=Ua});var Xa=a((Q9,Ca)=>{"use strict";var G6=g(),L6=C(),R6=X();function D6(r){var e=G6(r);return e=(e&L6)>>>20,e-R6|0}Ca.exports=D6});var Ka=a((k9,Va)=>{"use strict";var U6=Xa();Va.exports=U6});var $a=a((z9,Za)=>{"use strict";var M6=S(),B6=x(),C6=X(),X6=c0(),V6=l0(),K6=_0(),Z6=O(),$6=V(),Y6=nr(),Q6=Ba().assign,k6=Ka(),z6=ur(),J6=tr(),j6=2220446049250313e-31,r2=2148532223,ee=[0,0],te=[0,0];function e2(r,e){var i,t;return e===0||r===0||Z6(r)||$6(r)?r:(Q6(r,ee,1,0),r=ee[0],e+=ee[1],e+=k6(r),e<K6?Y6(0,r):e>X6?r<0?B6:M6:(e<=V6?(e+=52,t=j6):t=1,z6.assign(r,te,1,0),i=te[0],i&=r2,i|=e+C6<<20,t*J6(i,te[1])))}Za.exports=e2});var or=a((J9,Ya)=>{"use strict";var t2=$a();Ya.exports=t2});var ka=a((j9,Qa)=>{"use strict";function i2(r,e){var i,t;for(i=[],t=0;t<e;t++)i.push(r);return i}Qa.exports=i2});var Ja=a((r5,za)=>{"use strict";var a2=ka();za.exports=a2});var rs=a((e5,ja)=>{"use strict";var s2=Ja();function u2(r){return s2(0,r)}ja.exports=u2});var ts=a((t5,es)=>{"use strict";var n2=rs();es.exports=n2});var ns=a((i5,us)=>{"use strict";var v2=ir(),fr=or(),lr=ts(),as=[10680707,7228996,1387004,2578385,16069853,12639074,9804092,4427841,16666979,11263675,12935607,2387514,4345298,14681673,3074569,13734428,16653803,1880361,10960616,8533493,3062596,8710556,7349940,6258241,3772886,3769171,3798172,8675211,12450088,3874808,9961438,366607,15675153,9132554,7151469,3571407,2607881,12013382,4155038,6285869,7677882,13102053,15825725,473591,9065106,15363067,6271263,9264392,5636912,4652155,7056368,13614112,10155062,1944035,9527646,15080200,6658437,6231200,6832269,16767104,5075751,3212806,1398474,7579849,6349435,12618859],o2=[1.570796251296997,7549789415861596e-23,5390302529957765e-30,3282003415807913e-37,1270655753080676e-44,12293330898111133e-52,27337005381646456e-60,21674168387780482e-67],ie=16777216,ae=5960464477539063e-23,cr=lr(20),is=lr(20),pr=lr(20),E=lr(20);function ss(r,e,i,t,u,s,f,v,l){var o,n,p,I,c,A,N,q,_;for(I=s,_=t[i],q=i,c=0;q>0;c++)n=ae*_|0,E[c]=_-ie*n|0,_=t[q-1]+n,q-=1;if(_=fr(_,u),_-=8*v2(_*.125),N=_|0,_-=N,p=0,u>0?(c=E[i-1]>>24-u,N+=c,E[i-1]-=c<<24-u,p=E[i-1]>>23-u):u===0?p=E[i-1]>>23:_>=.5&&(p=2),p>0){for(N+=1,o=0,c=0;c<i;c++)q=E[c],o===0?q!==0&&(o=1,E[c]=16777216-q):E[c]=16777215-q;if(u>0)switch(u){case 1:E[i-1]&=8388607;break;case 2:E[i-1]&=4194303;break}p===2&&(_=1-_,o!==0&&(_-=fr(1,u)))}if(_===0){for(q=0,c=i-1;c>=s;c--)q|=E[c];if(q===0){for(A=1;E[s-A]===0;A++);for(c=i+1;c<=i+A;c++){for(l[v+c]=as[f+c],n=0,q=0;q<=v;q++)n+=r[q]*l[v+(c-q)];t[c]=n}return i+=A,ss(r,e,i,t,u,s,f,v,l)}for(i-=1,u-=24;E[i]===0;)i-=1,u-=24}else _=fr(_,-u),_>=ie?(n=ae*_|0,E[i]=_-ie*n|0,i+=1,u+=24,E[i]=n):E[i]=_|0;for(n=fr(1,u),c=i;c>=0;c--)t[c]=n*E[c],n*=ae;for(c=i;c>=0;c--){for(n=0,A=0;A<=I&&A<=i-c;A++)n+=o2[A]*t[c+A];pr[i-c]=n}for(n=0,c=i;c>=0;c--)n+=pr[c];for(p===0?e[0]=n:e[0]=-n,n=pr[0]-n,c=1;c<=i;c++)n+=pr[c];return p===0?e[1]=n:e[1]=-n,N&7}function f2(r,e,i,t){var u,s,f,v,l,o,n,p,I;for(s=4,v=t-1,f=(i-3)/24|0,f<0&&(f=0),o=i-24*(f+1),p=f-v,I=v+s,n=0;n<=I;n++)p<0?cr[n]=0:cr[n]=as[p],p+=1;for(n=0;n<=s;n++){for(u=0,p=0;p<=v;p++)u+=r[p]*cr[v+(n-p)];is[n]=u}return l=s,ss(r,e,l,is,o,s,f,v,cr)}us.exports=f2});var os=a((a5,vs)=>{"use strict";var c2=Math.round;vs.exports=c2});var cs=a((s5,fs)=>{"use strict";var p2=os();fs.exports=p2});var _s=a((u5,qs)=>{"use strict";var l2=cs(),ps=g(),q2=.6366197723675814,_2=1.5707963267341256,I2=6077100506506192e-26,A2=6077100506303966e-26,E2=20222662487959506e-37,N2=20222662487111665e-37,g2=84784276603689e-45,ls=2047;function d2(r,e,i){var t,u,s,f,v,l,o;return u=l2(r*q2),f=r-u*_2,v=u*I2,o=e>>20|0,i[0]=f-v,t=ps(i[0]),l=o-(t>>20&ls),l>16&&(s=f,v=u*A2,f=s-v,v=u*E2-(s-f-v),i[0]=f-v,t=ps(i[0]),l=o-(t>>20&ls),l>49&&(s=f,v=u*N2,f=s-v,v=u*g2-(s-f-v),i[0]=f-v)),i[1]=f-i[0]-v,u}qs.exports=d2});var As=a((n5,Is)=>{"use strict";var O2=m(),S2=C(),m2=Cr(),H2=g(),h2=Vi(),F2=tr(),x2=ns(),qr=_s(),T2=0,P2=16777216,T=1.5707963267341256,U=6077100506506192e-26,_r=2*U,Ir=3*U,Ar=4*U,w2=598523,y2=1072243195,W2=1073928572,b2=1074752122,G2=1074977148,L2=1075183036,R2=1075388923,D2=1075594811,U2=1094263291,k=[0,0,0],z=[0,0];function M2(r,e){var i,t,u,s,f,v,l,o;if(u=H2(r)|0,s=u&O2|0,s<=y2)return e[0]=r,e[1]=0,0;if(s<=b2)return(s&m2)===w2?qr(r,s,e):s<=W2?u>0?(o=r-T,e[0]=o-U,e[1]=o-e[0]-U,1):(o=r+T,e[0]=o+U,e[1]=o-e[0]+U,-1):u>0?(o=r-2*T,e[0]=o-_r,e[1]=o-e[0]-_r,2):(o=r+2*T,e[0]=o+_r,e[1]=o-e[0]+_r,-2);if(s<=D2)return s<=L2?s===G2?qr(r,s,e):u>0?(o=r-3*T,e[0]=o-Ir,e[1]=o-e[0]-Ir,3):(o=r+3*T,e[0]=o+Ir,e[1]=o-e[0]+Ir,-3):s===R2?qr(r,s,e):u>0?(o=r-4*T,e[0]=o-Ar,e[1]=o-e[0]-Ar,4):(o=r+4*T,e[0]=o+Ar,e[1]=o-e[0]+Ar,-4);if(s<U2)return qr(r,s,e);if(s>=S2)return e[0]=NaN,e[1]=NaN,0;for(i=h2(r),t=(s>>20)-1046,o=F2(s-(t<<20|0),i),v=0;v<2;v++)k[v]=o|0,o=(o-k[v])*P2;for(k[2]=o,f=3;k[f-1]===T2;)f-=1;return l=x2(k,z,t,f,1),u<0?(e[0]=-z[0],e[1]=-z[1],-l):(e[0]=z[0],e[1]=z[1],l)}Is.exports=M2});var Er=a((v5,Es)=>{"use strict";var B2=As();Es.exports=B2});var ds=a((o5,gs)=>{"use strict";var C2=m(),X2=C(),V2=g(),Ns=Mr(),se=Br(),K2=Er(),Z2=1072243195,$2=1045430272,H=[0,0];function Y2(r){var e,i;if(e=V2(r),e&=C2,e<=Z2)return e<$2?r:se(r,0);if(e>=X2)return NaN;switch(i=K2(r,H),i&3){case 0:return se(H[0],H[1]);case 1:return Ns(H[0],H[1]);case 2:return-se(H[0],H[1]);default:return-Ns(H[0],H[1])}}gs.exports=Y2});var Ss=a((f5,Os)=>{"use strict";var Q2=ds();Os.exports=Q2});var hs=a((c5,Hs)=>{"use strict";var k2=g(),ue=Mr(),ms=Br(),z2=Er(),J2=m(),j2=C(),h=[0,0],rc=1072243195,ec=1044381696;function tc(r){var e,i;if(e=k2(r),e&=J2,e<=rc)return e<ec?1:ue(r,0);if(e>=j2)return NaN;switch(i=z2(r,h),i&3){case 0:return ue(h[0],h[1]);case 1:return-ms(h[0],h[1]);case 2:return-ue(h[0],h[1]);default:return ms(h[0],h[1])}}Hs.exports=tc});var xs=a((p5,Fs)=>{"use strict";var ic=hs();Fs.exports=ic});var Ps=a((l5,Ts)=>{"use strict";var ac=R(),ne;ac===!0?ne=0:ne=1;Ts.exports=ne});var ys=a((q5,ws)=>{"use strict";var sc=G(),uc=L(),nc=Ps(),ve=new uc(1),vc=new sc(ve.buffer);function oc(r,e){return ve[0]=r,vc[nc]=e>>>0,ve[0]}ws.exports=oc});var Z=a((_5,Ws)=>{"use strict";var fc=ys();Ws.exports=fc});var Gs=a((I5,bs)=>{"use strict";function cc(r){return r===0?.13333333333320124:.13333333333320124+r*(.021869488294859542+r*(.0035920791075913124+r*(.0005880412408202641+r*(7817944429395571e-20+r*-18558637485527546e-21))))}bs.exports=cc});var Rs=a((A5,Ls)=>{"use strict";function pc(r){return r===0?.05396825397622605:.05396825397622605+r*(.0088632398235993+r*(.0014562094543252903+r*(.0002464631348184699+r*(7140724913826082e-20+r*2590730518636337e-20))))}Ls.exports=pc});var Ms=a((E5,Us)=>{"use strict";var lc=g(),Ds=Z(),qc=Gs(),_c=Rs(),Ic=.7853981633974483,Ac=3061616997868383e-32,Ec=.3333333333333341,Nc=2147483647;function gc(r,e,i){var t,u,s,f,v,l,o,n,p;return t=lc(r),u=t&Nc|0,u>=1072010280&&(r<0&&(r=-r,e=-e),p=Ic-r,n=Ac-e,r=p+n,e=0),p=r*r,n=p*p,f=qc(n),o=p*_c(n),v=p*r,f=e+p*(v*(f+o)+e),f+=Ec*v,n=r+f,u>=1072010280?(o=i,(1-(t>>30&2))*(o-2*(r-(n*n/(n+o)-f)))):i===1?n:(p=Ds(n,0),o=f-(p-r),s=-1/n,l=Ds(s,0),v=1+l*p,l+s*(v+l*o))}Us.exports=gc});var Cs=a((N5,Bs)=>{"use strict";var dc=Ms();Bs.exports=dc});var Ks=a((g5,Vs)=>{"use strict";var Oc=g(),Xs=Cs(),Sc=Er(),mc=m(),Hc=C(),oe=[0,0],hc=1072243195,Fc=1044381696;function xc(r){var e,i;return e=Oc(r),e&=mc,e<=hc?e<Fc?r:Xs(r,0,1):e>=Hc?NaN:(i=Sc(r,oe),Xs(oe[0],oe[1],1-((i&1)<<1)))}Vs.exports=xc});var $s=a((d5,Zs)=>{"use strict";var Tc=Ks();Zs.exports=Tc});var Qs=a((O5,Ys)=>{"use strict";var Pc=1.5707963267948966;Ys.exports=Pc});var Nr=a((S5,ks)=>{"use strict";var wc=.7853981633974483;ks.exports=wc});var Js=a((m5,zs)=>{"use strict";function yc(r){return r===0?-64.85021904942025:-64.85021904942025+r*(-122.88666844901361+r*(-75.00855792314705+r*(-16.157537187333652+r*-.8750608600031904)))}zs.exports=yc});var ru=a((H5,js)=>{"use strict";function Wc(r){return r===0?194.5506571482614:194.5506571482614+r*(485.3903996359137+r*(432.88106049129027+r*(165.02700983169885+r*(24.858464901423062+r*1))))}js.exports=Wc});var iu=a((h5,tu)=>{"use strict";var bc=O(),Gc=S(),fe=Qs(),Lc=Nr(),Rc=x(),Dc=Js(),Uc=ru(),eu=6123233995736766e-32,Mc=2.414213562373095;function Bc(r){var e,i,t,u;return bc(r)||r===0?r:r===Gc?fe:r===Rc?-fe:(r<0&&(i=!0,r=-r),e=0,r>Mc?(t=fe,e=1,r=-(1/r)):r<=.66?t=0:(t=Lc,e=2,r=(r-1)/(r+1)),u=r*r,u=u*Dc(u)/Uc(u),u=r*u+r,e===2?u+=.5*eu:e===1&&(u+=eu),t+=u,i?-t:t)}tu.exports=Bc});var ce=a((F5,au)=>{"use strict";var Cc=iu();au.exports=Cc});var uu=a((x5,su)=>{"use strict";var Xc=g();function Vc(r){var e=Xc(r);return!!(e>>>31)}su.exports=Vc});var vu=a((T5,nu)=>{"use strict";var Kc=uu();nu.exports=Kc});var fu=a((P5,ou)=>{"use strict";var Zc=3.141592653589793;ou.exports=Zc});var lu=a((w5,pu)=>{"use strict";var gr=V(),P=nr(),$c=vu(),cu=O(),Yc=ce(),Qc=S(),w=fu();function kc(r,e){var i;return cu(e)||cu(r)?NaN:gr(e)?e===Qc?gr(r)?P(w/4,r):P(0,r):gr(r)?P(3*w/4,r):P(w,r):gr(r)?P(w/2,r):r===0?e>=0&&!$c(e)?P(0,r):P(w,r):e===0?P(w/2,r):(i=Yc(r/e),e<0?i<=0?i+w:i-w:i)}pu.exports=kc});var _u=a((y5,qu)=>{"use strict";var zc=lu();qu.exports=zc});var Au=a((W5,Iu)=>{"use strict";var Jc=Math.sqrt;Iu.exports=Jc});var J=a((b5,Eu)=>{"use strict";var jc=Au();Eu.exports=jc});var gu=a((G5,Nu)=>{"use strict";function r3(r){var e,i,t;return r===0?.16666666666666713:(r<0?e=-r:e=r,e<=1?(i=-8.198089802484825+r*(19.562619833175948+r*(-16.262479672107002+r*(5.444622390564711+r*(-.6019598008014124+r*.004253011369004428)))),t=-49.18853881490881+r*(139.51056146574857+r*(-147.1791292232726+r*(70.49610280856842+r*(-14.740913729888538+r*1))))):(r=1/r,i=.004253011369004428+r*(-.6019598008014124+r*(5.444622390564711+r*(-16.262479672107002+r*(19.562619833175948+r*-8.198089802484825)))),t=1+r*(-14.740913729888538+r*(70.49610280856842+r*(-147.1791292232726+r*(139.51056146574857+r*-49.18853881490881))))),i/t)}Nu.exports=r3});var Ou=a((L5,du)=>{"use strict";function e3(r){var e,i,t;return r===0?.08333333333333809:(r<0?e=-r:e=r,e<=1?(i=28.536655482610616+r*(-25.56901049652825+r*(6.968710824104713+r*(-.5634242780008963+r*.002967721961301243))),t=342.43986579130785+r*(-383.8770957603691+r*(147.0656354026815+r*(-21.947795316429207+r*1)))):(r=1/r,i=.002967721961301243+r*(-.5634242780008963+r*(6.968710824104713+r*(-25.56901049652825+r*28.536655482610616))),t=1+r*(-21.947795316429207+r*(147.0656354026815+r*(-383.8770957603691+r*342.43986579130785)))),i/t)}du.exports=e3});var Hu=a((R5,mu)=>{"use strict";var t3=O(),i3=J(),Su=Nr(),a3=gu(),s3=Ou(),u3=6123233995736766e-32;function n3(r){var e,i,t,u,s;if(t3(r))return NaN;if(r>0?t=r:(e=!0,t=-r),t>1)return NaN;if(t>.625)i=1-t,u=i*s3(i),i=i3(i+i),s=Su-i,i=i*u-u3,s-=i,s+=Su;else{if(t<1e-8)return r;i=t*t,s=i*a3(i),s=t*s+t}return e?-s:s}mu.exports=n3});var pe=a((D5,hu)=>{"use strict";var v3=Hu();hu.exports=v3});var Pu=a((U5,Tu)=>{"use strict";var o3=O(),Fu=pe(),f3=J(),xu=Nr(),c3=6123233995736766e-32;function p3(r){var e;return o3(r)?NaN:r<-1||r>1?NaN:r>.5?2*Fu(f3(.5-.5*r)):(e=xu-Fu(r),e+=c3,e+=xu,e)}Tu.exports=p3});var yu=a((M5,wu)=>{"use strict";var l3=Pu();wu.exports=l3});var bu=a((B5,Wu)=>{"use strict";var q3=Math.ceil;Wu.exports=q3});var Lu=a((C5,Gu)=>{"use strict";var _3=bu();Gu.exports=_3});var Du=a((X5,Ru)=>{"use strict";var I3=ir(),A3=Lu();function E3(r){return r<0?A3(r):I3(r)}Ru.exports=E3});var Mu=a((V5,Uu)=>{"use strict";var N3=Du();Uu.exports=N3});var Cu=a((K5,Bu)=>{"use strict";function g3(r){return r===0?.16666666666666602:.16666666666666602+r*(-.0027777777777015593+r*(6613756321437934e-20+r*(-16533902205465252e-22+r*41381367970572385e-24)))}Bu.exports=g3});var Vu=a((Z5,Xu)=>{"use strict";var d3=or(),O3=Cu();function S3(r,e,i){var t,u,s,f;return t=r-e,u=t*t,s=t-u*O3(u),f=1-(e-t*s/(2-s)-r),d3(f,i)}Xu.exports=S3});var ku=a(($5,Qu)=>{"use strict";var m3=O(),Ku=Mu(),H3=x(),Zu=S(),h3=Vu(),F3=.6931471803691238,x3=19082149292705877e-26,$u=1.4426950408889634,T3=709.782712893384,P3=-745.1332191019411,Yu=1/(1<<28),w3=-Yu;function y3(r){var e,i,t;return m3(r)||r===Zu?r:r===H3?0:r>T3?Zu:r<P3?0:r>w3&&r<Yu?1+r:(r<0?t=Ku($u*r-.5):t=Ku($u*r+.5),e=r-t*F3,i=t*x3,h3(e,i,t))}Qu.exports=y3});var Ju=a((Y5,zu)=>{"use strict";var W3=ku();zu.exports=W3});var rn=a((Q5,ju)=>{"use strict";var b3=R(),le;b3===!0?le=1:le=0;ju.exports=le});var tn=a((k5,en)=>{"use strict";var G3=G(),L3=L(),R3=rn(),qe=new L3(1),D3=new G3(qe.buffer);function U3(r,e){return qe[0]=r,D3[R3]=e>>>0,qe[0]}en.exports=U3});var dr=a((z5,an)=>{"use strict";var M3=tn();an.exports=M3});var un=a((J5,sn)=>{"use strict";function B3(r){return r===0?.3999999999940942:.3999999999940942+r*(.22222198432149784+r*.15313837699209373)}sn.exports=B3});var vn=a((j5,nn)=>{"use strict";function C3(r){return r===0?.6666666666666735:.6666666666666735+r*(.2857142874366239+r*(.1818357216161805+r*.14798198605116586))}nn.exports=C3});var pn=a((r8,cn)=>{"use strict";var on=g(),X3=dr(),V3=O(),K3=X(),Z3=x(),$3=un(),Y3=vn(),Or=.6931471803691238,Sr=19082149292705877e-26,Q3=0x40000000000000,k3=.3333333333333333,fn=1048575,z3=2146435072,J3=1048576,j3=1072693248;function rp(r){var e,i,t,u,s,f,v,l,o,n,p,I;return r===0?Z3:V3(r)||r<0?NaN:(i=on(r),s=0,i<J3&&(s-=54,r*=Q3,i=on(r)),i>=z3?r+r:(s+=(i>>20)-K3|0,i&=fn,l=i+614244&1048576|0,r=X3(r,i|l^j3),s+=l>>20|0,v=r-1,(fn&2+i)<3?v===0?s===0?0:s*Or+s*Sr:(f=v*v*(.5-k3*v),s===0?v-f:s*Or-(f-s*Sr-v)):(n=v/(2+v),I=n*n,l=i-398458|0,p=I*I,o=440401-i|0,u=p*$3(p),t=I*Y3(p),l|=o,f=t+u,l>0?(e=.5*v*v,s===0?v-(e-n*(e+f)):s*Or-(e-(n*(e+f)+s*Sr)-v)):s===0?v-n*(v-f):s*Or-(n*(v-f)-s*Sr-v))))}cn.exports=rp});var qn=a((e8,ln)=>{"use strict";var ep=pn();ln.exports=ep});var An=a((t8,In)=>{"use strict";var _n=qn();function tp(r,e){return _n(r)/_n(e)}In.exports=tp});var Nn=a((i8,En)=>{"use strict";var ip=An();En.exports=ip});var dn=a((a8,gn)=>{"use strict";var ap=ir();function sp(r){return ap(r)===r}gn.exports=sp});var _e=a((s8,On)=>{"use strict";var up=dn();On.exports=up});var mn=a((u8,Sn)=>{"use strict";var np=_e();function vp(r){return np(r/2)}Sn.exports=vp});var hn=a((n8,Hn)=>{"use strict";var op=mn();Hn.exports=op});var Tn=a((v8,xn)=>{"use strict";var Fn=hn();function fp(r){return r>0?Fn(r-1):Fn(r+1)}xn.exports=fp});var Ie=a((o8,Pn)=>{"use strict";var cp=Tn();Pn.exports=cp});var yn=a((f8,wn)=>{"use strict";function pp(r){return r|0}wn.exports=pp});var Ae=a((c8,Wn)=>{"use strict";var lp=yn();Wn.exports=lp});var Ln=a((p8,Gn)=>{"use strict";var bn=Ie(),qp=nr(),_p=x(),mr=S();function Ip(r,e){return e===_p?mr:e===mr?0:e>0?bn(e)?r:0:bn(e)?qp(mr,r):mr}Gn.exports=Ip});var Dn=a((l8,Rn)=>{"use strict";var Ap=m(),Ep=g(),Np=1072693247,Hr=1e300,hr=1e-300;function gp(r,e){var i,t;return t=Ep(r),i=t&Ap,i<=Np?e<0?Hr*Hr:hr*hr:e>0?Hr*Hr:hr*hr}Rn.exports=gp});var Bn=a((q8,Mn)=>{"use strict";var dp=vr(),Un=S();function Op(r,e){return r===-1?(r-r)/(r-r):r===1?1:dp(r)<1==(e===Un)?0:Un}Mn.exports=Op});var Ee=a((_8,Cn)=>{"use strict";var Sp=20;Cn.exports=Sp});var Vn=a((I8,Xn)=>{"use strict";function mp(r){return r===0?.5999999999999946:.5999999999999946+r*(.4285714285785502+r*(.33333332981837743+r*(.272728123808534+r*(.23066074577556175+r*.20697501780033842))))}Xn.exports=mp});var Yn=a((A8,$n)=>{"use strict";var Hp=g(),Fr=Z(),Kn=dr(),hp=X(),Fp=Ee(),xp=Vn(),Tp=1048575,Zn=1048576,Pp=1072693248,wp=536870912,yp=524288,Wp=9007199254740992,bp=.9617966939259756,Gp=.9617967009544373,Lp=-7028461650952758e-24,Rp=[1,1.5],Dp=[0,.5849624872207642],Up=[0,1350039202129749e-23];function Mp(r,e,i){var t,u,s,f,v,l,o,n,p,I,c,A,N,q,_,xr,rr,M,B,$,er,b;return $=0,i<Zn&&(e*=Wp,$-=53,i=Hp(e)),$+=(i>>Fp)-hp|0,er=i&Tp|0,i=er|Pp|0,er<=235662?b=0:er<767610?b=1:(b=0,$+=1,i-=Zn),e=Kn(e,i),n=Rp[b],M=e-n,B=1/(e+n),u=M*B,f=Fr(u,0),t=(i>>1|wp)+yp,t+=b<<18,l=Kn(0,t),o=e-(l-n),v=B*(M-f*l-f*o),s=u*u,rr=s*s*xp(s),rr+=v*(f+u),s=f*f,l=3+s+rr,l=Fr(l,0),o=rr-(l-3-s),M=f*l,B=v*l+o*u,I=M+B,I=Fr(I,0),c=B-(I-M),A=Gp*I,N=Lp*I+c*bp+Up[b],p=Dp[b],xr=$,q=A+N+p+xr,q=Fr(q,0),_=N-(q-xr-p-A),r[0]=q,r[1]=_,r}$n.exports=Mp});var kn=a((E8,Qn)=>{"use strict";function Bp(r){return r===0?.5:.5+r*(-.3333333333333333+r*.25)}Qn.exports=Bp});var Jn=a((N8,zn)=>{"use strict";var Cp=Z(),Xp=kn(),Vp=1.4426950408889634,Kp=1.4426950216293335,Zp=19259629911266175e-24;function $p(r,e){var i,t,u,s,f,v;return u=e-1,s=u*u*Xp(u),f=Kp*u,v=u*Zp-s*Vp,t=f+v,t=Cp(t,0),i=v-(t-f),r[0]=t,r[1]=i,r}zn.exports=$p});var rv=a((g8,jn)=>{"use strict";var Yp=.6931471805599453;jn.exports=Yp});var tv=a((d8,ev)=>{"use strict";function Qp(r){return r===0?.16666666666666602:.16666666666666602+r*(-.0027777777777015593+r*(6613756321437934e-20+r*(-16533902205465252e-22+r*41381367970572385e-24)))}ev.exports=Qp});var ov=a((O8,vv)=>{"use strict";var kp=g(),iv=dr(),zp=Z(),Jp=Ae(),jp=or(),rl=rv(),av=X(),sv=m(),uv=Cr(),j=Ee(),el=tv(),nv=1048576,tl=1071644672,il=.6931471824645996,al=-1904654299957768e-24;function sl(r,e,i){var t,u,s,f,v,l,o,n,p,I,c;return I=r&sv|0,c=(I>>j)-av|0,p=0,I>tl&&(p=r+(nv>>c+1)>>>0,c=((p&sv)>>j)-av|0,t=(p&~(uv>>c))>>>0,s=iv(0,t),p=(p&uv|nv)>>j-c>>>0,r<0&&(p=-p),e-=s),s=i+e,s=zp(s,0),v=s*il,l=(i-(s-e))*rl+s*al,n=v+l,o=l-(n-v),s=n*n,u=n-s*el(s),f=n*u/(u-2)-(o+n*o),n=1-(f-n),r=kp(n),r=Jp(r),r+=p<<j>>>0,r>>j<=0?n=jp(n,p):n=iv(n,r),n}vv.exports=sl});var gv=a((S8,Nv)=>{"use strict";var fv=O(),cv=Ie(),pv=V(),ul=_e(),lv=J(),nl=vr(),Ne=ur(),vl=Z(),qv=Ae(),ol=x(),fl=S(),ge=m(),cl=Ln(),pl=Dn(),ll=Bn(),ql=Yn(),_l=Jn(),Il=ov(),Al=1072693247,El=1105199104,Nl=1139802112,_v=1083179008,gl=1072693248,dl=1083231232,Ol=3230714880,Iv=31,y=1e300,W=1e-300,Sl=8008566259537294e-32,F=[0,0],Av=[0,0];function Ev(r,e){var i,t,u,s,f,v,l,o,n,p,I,c,A,N,q,_;if(fv(r)||fv(e))return NaN;if(Ne.assign(e,F,1,0),v=F[0],l=F[1],l===0){if(e===0)return 1;if(e===1)return r;if(e===-1)return 1/r;if(e===.5)return lv(r);if(e===-.5)return 1/lv(r);if(e===2)return r*r;if(e===3)return r*r*r;if(e===4)return r*=r,r*r;if(pv(e))return ll(r,e)}if(Ne.assign(r,F,1,0),s=F[0],f=F[1],f===0){if(s===0)return cl(r,e);if(r===1)return 1;if(r===-1&&cv(e))return-1;if(pv(r))return r===ol?Ev(-0,-e):e<0?0:fl}if(r<0&&ul(e)===!1)return(r-r)/(r-r);if(u=nl(r),i=s&ge|0,t=v&ge|0,o=s>>>Iv|0,n=v>>>Iv|0,o&&cv(e)?o=-1:o=1,t>El){if(t>Nl)return pl(r,e);if(i<Al)return n===1?o*y*y:o*W*W;if(i>gl)return n===0?o*y*y:o*W*W;A=_l(Av,u)}else A=ql(Av,u,i);if(p=vl(e,0),c=(e-p)*A[0]+e*A[1],I=p*A[0],N=c+I,Ne.assign(N,F,1,0),q=qv(F[0]),_=qv(F[1]),q>=_v){if((q-_v|_)!==0||c+Sl>N-I)return o*y*y}else if((q&ge)>=dl&&((q-Ol|_)!==0||c<=N-I))return o*W*W;return N=Il(q,I,c),o*N}Nv.exports=Ev});var Ov=a((m8,dv)=>{"use strict";var ml=gv();dv.exports=ml});var hv=a((H8,Hv)=>{"use strict";var Sv=O(),mv=V(),Hl=S(),hl=J();function Fl(r,e){var i;return mv(r)||mv(e)?Hl:Sv(r)||Sv(e)?NaN:(r<0&&(r=-r),e<0&&(e=-e),r<e&&(i=e,e=r,r=i),r===0?0:(e/=r,r*hl(1+e*e)))}Hv.exports=Fl});var xv=a((h8,Fv)=>{"use strict";var xl=hv();Fv.exports=xl});var Tl=d(Ss(),1),Pl=d(xs(),1),wl=d($s(),1),yl=d(ce(),1),Wl=d(_u(),1),bl=d(pe(),1),Gl=d(yu(),1),Ll=d(Ju(),1),Rl=d(Nn(),1),Dl=d(Ov(),1),Ul=d(xv(),1);var export_acos=Gl.default;var export_asin=bl.default;var export_atan=yl.default;var export_atan2=Wl.default;var export_cos=Pl.default;var export_exp=Ll.default;var export_hypot=Ul.default;var export_log=Rl.default;var export_pow=Dl.default;var export_sin=Tl.default;var export_tan=wl.default;export{export_acos as acos,export_asin as asin,export_atan as atan,export_atan2 as atan2,export_cos as cos,export_exp as exp,export_hypot as hypot,export_log as log,export_pow as pow,export_sin as sin,export_tan as tan};
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
@stdlib/math-base-special-log/lib/main.js:
@stdlib/math-base-special-log/lib/index.js:
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
