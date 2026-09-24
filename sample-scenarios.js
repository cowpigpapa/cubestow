// 테스트용 샘플 시나리오. 단위는 mm·kg이며 maxTopLoadKg:0은 상부 적재 금지 화물이다.
// container·mode는 샘플을 불러올 때 함께 선택하는 컨테이너 규격과 운송모드다.
const SAMPLE_CATEGORIES=['가전','가구','부품·기계','원통','팔레트·건자재','혼합·기타'];
const SAMPLE_SETS=(()=>{
const box=(name,group,qty,l,w,h,weight,maxTopLoadKg,rotate=false,fragile=false)=>({name,group,shape:'box',qty,l,w,h,weight,maxTopLoadKg,rotate,fragile});
const drum=(name,group,qty,diameter,h,weight,maxTopLoadKg)=>({name,group,shape:'cylinder',qty,l:diameter,w:diameter,h,weight,maxTopLoadKg,rotate:false,fragile:false});
return{
  1:{name:'혼합 화물',category:'혼합·기타',container:'20ft',mode:'combined',description:'박스·원통·취약 화물이 섞인 종합 검증',products:[
    box('산업용 펌프','기계류',4,1200,800,900,420,2000,true),box('제어반','전기장비',6,900,600,1100,180,0,false,true),
    drum('케이블 드럼','부품',10,900,700,310,1200),box('필터 박스','소모품',16,600,500,450,52,500,true)]},
  2:{name:'단일 규격 반복',category:'부품·기계',container:'20ft',mode:'combined',description:'같은 제품 42개의 정렬·반복 적재 검증',products:[
    box('표준 수출박스','포장화물',42,1000,780,720,145,1000)]},
  3:{name:'크기 차이 비교',category:'부품·기계',container:'20ft',mode:'combined',description:'대·중·소 화물의 빈 공간 활용 검증',products:[
    box('대형 설비박스','설비',3,1800,1100,1250,780,3000),box('중형 부품박스','부품',10,1000,720,650,165,800,true),box('소형 완충박스','소모품',24,480,380,320,28,250,true)]},
  4:{name:'양문형 냉장고',category:'가전',container:'40hc',mode:'sea',description:'세워서만 싣고 위에 올리지 않는 대형 가전의 단층 적재',products:[
    box('양문형 냉장고','대형가전',36,920,760,1850,135,0,false,true)]},
  5:{name:'세탁기·건조기 2단',category:'가전',container:'40hc',mode:'combined',description:'같은 바닥 규격 가전의 2단 적재와 상부 허용하중',products:[
    box('드럼 세탁기','대형가전',60,700,740,1020,78,160),box('건조기','대형가전',36,700,740,1020,48,160)]},
  6:{name:'TV 세움 포장',category:'가전',container:'40ft',mode:'road',description:'얇고 높은 박스의 전도·측면 지지 검토',products:[
    box('75형 TV','영상가전',40,1850,260,1150,42,0,false,true),box('55형 TV','영상가전',60,1380,190,860,21,40)]},
  7:{name:'소형 가전 혼합',category:'가전',container:'20ft',mode:'combined',description:'회전 가능한 소형 카톤 여러 규격의 빈틈 채움',products:[
    box('전자레인지','주방가전',60,560,460,360,16,120,true),box('무선청소기','생활가전',80,780,300,260,7,60,true),
    box('에어프라이어','주방가전',70,420,400,420,8,80,true),box('전기밥솥','주방가전',60,400,350,330,6,60,true)]},
  8:{name:'소파·매트리스',category:'가구',container:'40hc',mode:'sea',description:'부피가 크고 가벼운 가구와 압축 매트리스 롤',products:[
    box('3인 소파','가구',12,2150,950,880,85,60),box('1인 소파','가구',16,950,900,880,38,60),drum('압축 매트리스 롤','침구',40,450,1100,32,100)]},
  9:{name:'조립식 가구 플랫팩',category:'가구',container:'40hc',mode:'combined',description:'납작하고 긴 박스의 눕힘·세움 회전 조합',products:[
    box('옷장 패널','조립가구',60,2050,620,160,58,600,true),box('책장','조립가구',80,1850,420,120,32,400,true),box('식탁 상판','조립가구',40,1650,950,110,38,500,true)]},
  10:{name:'사무용 가구',category:'가구',container:'40ft',mode:'road',description:'철제 캐비닛·책상·의자 혼합과 약한 의자 박스',products:[
    box('철제 캐비닛','사무가구',20,900,460,1320,72,300),box('사무용 책상','사무가구',30,1620,820,160,46,400,true),box('사무용 의자','사무가구',60,700,680,640,17,20)]},
  11:{name:'자동차 부품 철제 팔레트',category:'부품·기계',container:'20ft',mode:'sea',description:'부피보다 중량이 먼저 한계에 닿는 고밀도 화물',products:[
    box('브레이크 부품 팔레트','자동차부품',24,1200,1000,750,1050,2100)]},
  12:{name:'엔진 크레이트',category:'부품·기계',container:'40ft',mode:'combined',description:'적층할 수 없는 중량물이라 중량 때문에 2대로 나뉨',products:[
    box('엔진 크레이트','기계류',22,1500,1050,1150,1350,0,false,true)]},
  13:{name:'전자 부품 카톤 400개',category:'부품·기계',container:'40hc',mode:'combined',description:'같은 소형 카톤 400개의 계산 속도와 반복 적재',products:[
    box('전자부품 카톤','전자부품',400,600,400,400,14,180,true)]},
  14:{name:'대형 케이블 드럼',category:'원통',container:'20ft',mode:'sea',description:'지름이 큰 원통의 2단 중심 정렬과 구름 방지',products:[
    drum('대형 케이블 드럼','전선',8,1400,1000,950,1000)]},
  15:{name:'200L 드럼통',category:'원통',container:'20ft',mode:'combined',description:'표준 드럼 2단 적층과 상부 허용하중',products:[
    drum('200L 드럼','화학제품',50,590,880,215,450)]},
  16:{name:'종이 롤',category:'원통',container:'40ft',mode:'sea',description:'무거운 원통의 단층 배치와 길이 방향 중량 분산',products:[
    drum('종이 롤','지류',24,1000,1300,850,900)]},
  17:{name:'음료 팔레트 2단',category:'팔레트·건자재',container:'20ft',mode:'road',description:'표준 팔레트 2단 적재와 상부 허용하중',products:[
    box('음료 팔레트','식음료',18,1200,1000,1100,780,900)]},
  18:{name:'가정 이사 화물',category:'혼합·기타',container:'20ft',mode:'sea',description:'규격이 제각각인 가구·가전·이삿짐 박스와 취약 화물',products:[
    box('장롱 박스','가구',3,1200,600,1950,95,50),box('냉장고','가전',1,700,720,1750,80,0,false,true),box('세탁기','가전',1,600,650,900,70,100),
    box('이삿짐 박스 대','이삿짐',40,550,450,450,20,120,true),box('이삿짐 박스 소','이삿짐',40,450,350,300,12,80,true),
    box('식탁','가구',1,1500,850,120,35,150,true),box('식탁 의자','가구',4,450,450,900,6,10),box('액자·거울','취약품',3,1200,100,900,15,0,false,true)]},
  19:{name:'강관 번들·타일 팔레트',category:'팔레트·건자재',container:'40ft',mode:'combined',description:'5.8m 장척 번들과 고밀도 타일 팔레트의 중량 배분',products:[
    box('강관 번들','철강',14,5800,320,320,480,1500),box('타일 팔레트','건자재',10,1100,1100,650,1250,2600)]},
  20:{name:'과대 화물 포함 부분 적재',category:'혼합·기타',container:'20ft',mode:'combined',description:'컨테이너보다 큰 화물이 섞여 미배치 보고를 확인',products:[
    box('표준 박스','포장화물',12,1000,800,800,150,900,true),box('과대 설비','설비',1,6200,1500,1500,2400,0),box('과높이 기계','기계류',1,1400,1200,2600,1800,0)]}
};
})();
