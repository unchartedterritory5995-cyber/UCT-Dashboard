// app/src/components/chart/engine/ast/paramIdPinned.js
//
// ─── H1 — THE SCRIPTS WHOSE PINNED-LANE PARAMETER MAP IS FIXED ─────────────────
//
// `docs/pine/param-ids.json` pins, for the 297 scripts present on this machine, every
// parameter id the plain strict lane gives them — and `paramIds.test.js` (whole
// maps) and `paramIdLegacy.test.js` (a pinned map is dense, 1..k, and matches its
// frozen entry) both forbid that lane from GROWING a pinned map. A pinned script
// with no ids at all (every one that refused when the map was frozen) can
// therefore never mint one there either. So in that lane a pinned script mints
// only what its frozen entry names (`pine.js::resolveInput`); every other lane,
// and every script not listed here, mints source ids as before.
//
// ⛔ DERIVED, NOT TYPED: `paramIdPinned.test.js` recomputes this list from
// `param-ids.json` (each present, non-throwing script's token-stream key) and
// fails if the two differ. An owner-ruled regeneration of that artifact moves this
// list in the same commit.
// KEY  `scriptKey(tokens)` (`paramIdSource.js`), sorted, eight per line.
const KEYS = `
1076groih0x 10jj6z3q832 10ut9c4m1i 116wcxvr0yz 119661ip4rv 11ql45zbtmw 11tjacx9gmh 129n3c77hkh
12jvqk68ycf 12tek3u3soq 12tynffg1hr 135gtkmljno 13g38vn5cxm 13k2iauzfu1 147w6ay870i 14iros38oip
14qg2ghhdut 14rl1irtbmr 14w8zi03lkw 15kngfyuhqb 163tfzmhh9t 1678bxmullv 16ah3wzt16n 16eznqkfl2
16lxrxmiexq 16t95s0dstb 16wu47w9m9 179zcncbuta 17eejkb74he 17h68vp976u 17mhat3su6q 17z8q8tg115
185njvsxpq9 18bpx1q53v2 18i9mx9zvna 198plk9ydtu 19w5jz6a0ej 1a6a90nblbk 1a7gfpkbg32 1b9f4ng4by9
1bkiukejvr8 1bokxz54jny 1bwnkm3bw8d 1c6khoo5m03 1d0ow5vc1tg 1dhif3stneh 1dub0gwbrxl 1eicgswnwhp
1eldhotnofs 1fk6tjqcn2d 1fu92qo4jxl 1g12tcbeho1 1gjmpswlioh 1gm82yj8kt0 1gtgejsfx8 1gue22k9evh
1h2u9k7660d 1hxwk1chyeb 1ib4g4rbcku 1igsai7op79 1j0nc4y1lg7 1jixlja6ee2 1jq4u2xh8mt 1knhxrnywbz
1knk7k1nh27 1ktijp66s8f 1l6gxn3xfmv 1lhlueiynwv 1lpo6pk70v3 1lq9wsplw98 1m8ixxk2udi 1mchy3i10yd
1mryx4czbgp 1mz4aipp6ao 1n2wb94545k 1nh6sx0wj76 1o2pvub3vhf 1onzewtrf53 1ovegmtga4a 1pl7js7bmzo
1pnzbwwdaep 1q9u8hgq3j8 1qgdb0yb8ml 1qurphv1c6s 1rc0bz64roo 1s68tlo360v 1sir5w6pwuo 1sxnnktsebx
1szi06sg2nn 1t281s6mhcl 1t62csltvgg 1t7pmvm3d62 1tbv3hivqgr 1tvzsdkz9qt 1uh9qaff8ah 1v76uq24fng
1v7755hiiz1 1vdhs08hq3x 1vx91o6now0 1wgurx1t04t 1wl8mv9mboj 1wpjqod02kj 1wz02swgs8r 1xaemcie22z
1xage3umyx3 1xcphrdwmm7 1xg47zny0kg 1xhv2m72ch2 1xi9oa5gvce 1xlm3be8iub 1xyeauz3cy0 1yepillrgn0
1ylvljs0xv1 1yotqn9xdfx 1yoyrhzh866 1yv1h25kyf5 1ywzclfsw5y 1z0gakj0m83 1z2vd2i93dr 1zbazwy9s3c
1zg1qvit7wd 201lz8i4c05 207rc7nvn7p 20d0bbfe2il 20nilw2za2m 212osn1871h 21622f6mhbc 21l5cz7mkll
21lmah6tx 21nkbazasle 21v2kxm0l2t 21w7117svy9 224bzu3jonx 228p4b2epjq 22bd2kzod4r 22y1kl9q8oj
2338ks7su5i 23gmahtzhos 23he5pqmhhv 23l7m2wk8o7 23qzm2jrkm5 23s48a7cerz 243m5iqqwfs 249w6oj0ebt
24jezrc9o3r 24kevxxxb57 254d7mwbn2d 25lwvqk6new 25mk7wj860s 26a2cu9wj0l 26r55dzyabs 26s9v5lqlct
270stzpt4s 27dl4mcciw1 27ev8ah7ai1 27tv09gq1bc 283er8nquk8 28fbtftchil 28uj5g9ezv9 298hov9yiu6
29ccg81mpwo 29cf24x7es 29lg4vktzx 29mtzjbhmtf 2a0v9cs72fs 2a90oksl8x 2aaw4ggcwj8 2azvktx25i4
2b3kiai8mt3 2bhs1j010xq 2bn6j4365ul 2bra3549xeg 2bwneh9zd3z 2cplnf1ozqk 2cy1rq9ybf0 2ec7z6ah5x2
2esle47dcpe 2etv7h7d0lb 2fc0z6kab43 2gg6zqlr2vz 2gid394h6dp 2x08m0xxsr 3gr2z8mu2l 3grhtu5wyy
3h5p1w7pr5 3q9is2st8n 3rgye68w23 44i70a9lfu 4bze6xsbcq 4cxui61nw5 4pog5v2ei4 4v0cwzmzu
51idl2tcew 5vuqcomzxa 6a410n99e6 6dlrqjt5az 6g6iika8oy 6xdlxto070 732kiccsrc 7z3hdx1v4x
80qwy2sqsn 8fi1t9bbsz 8fo0nruvw3 8kuf1emzzx 9626ux0c87 a407fxq5ll a4noqx76yr aevjwjxe8r
ao83c0ct0e axkfq18y25 bc83m2g8u0 bedmfmfz92 blqw77f5vq botk0w6osc c478tjstez c581cnbbwm
c7mfvlbp0b c9c4sy3gb2 cyztdy9yqw dfv5uzyjy8 dhancwnsfp dlu99zhu3h efqxv786lb egcljduvid
el6c5qjr0e ex9pymrq61 f0tyg2lx7i f547qdnqgx fg6vxuy5dt fkeozfku66 g63yb1ukp2 gixf08xs86
goad6fz3d5 gt1cevb9a4 hl5piddikt ii1bnto623 j0mj7qvxh0 k8kqugtnq8 kb4devof9r kd4buaks8m
km55eopl6z kojvbhs8jp l54dqawuem lima2ljhod llpgytmrqs lq9be978qr m1ij51dkjn m7dxu2swdn
mmge9gph6u mn4iexhdnx mov2h62k3y n6e10hln5u n8t5wvyti3 nag2e3qmym nlnqeowovx nsoobx2di0
nx8qat4mc2 nz84ifx9y5 ot5ufwxqx2 ozc5cdd2f2 p2kobsnn02 php7a76ojj ptdzl11r9t py54bfkrpx
q8altjoqiz qaj3ftxejv qfwgynvxle qlmha3gst3 qulzgi1oj4 r6e522rla1 rb6kj5m9ow ry1q6lwml9
s14qmtnbp1 s24vdcog01 sog4ot3ijm tf6tztzk tomn2ga4ut tpklb8vtn5 txfoxlqi9c uhl8608uxe
uit2eh258l uuze7iwate uwtzy1f0md v0z0apskn4 vefhm27etz w4tlp0lqo1 wa8cgxsixy wanbbnt3ta
xdzlqj2s2i xqi7eocrd5 xv579f8i0f ya2onjzm32 ymbydm0d6r yst2at0hj5 z4tfd8pghy zpmdlja8bl
zsz1dphj30
`
export const PINNED_SCRIPT_KEYS = Object.freeze(new Set(KEYS.split(/\s+/).filter(Boolean)))
