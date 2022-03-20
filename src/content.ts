console.log("content script running");

const PORN_THRESHOLD = 0.5;
const SEXY_WEIGHT = 0.3
const HENTAI_THRESHOLD = 0.5;
const WEIGHT_OF_PSCORE_IN_HSCORE = 0.5
const NUMBER_OF_IMAGES_TO_ANALYZE = 10;

const tabUrl = location.href;
console.log(tabUrl)
// @ts-expect-error because precise reason
let model: nsfwjs.NSFWJS;

chrome.storage.local.get(["defaultBlocklist"], function (result) {
  const defaultBlocklist: string[] = result.defaultBlocklist ?? [];
  console.log("defaultBlocklist", defaultBlocklist);
  if (defaultBlocklist.some((e) => tabUrl.includes(e))) {
    console.log('defaultBlocklist activée sur ' + tabUrl)
    PUNISH();
  }
});

chrome.storage.sync.get(["userBlocklist", "aiFiltering"], function (result) {
  const aiFiltering: boolean = result.aiFiltering ?? false;
  if (aiFiltering === true) {
    console.log("loading model...");
    // @ts-expect-error because precise reason
    nsfwjs.load().then((loaded) => {
      model = loaded;
      console.log("Loaded nsfwjs model");
      console.log("Getting predictions and score...");
      analysePage();
    });
  } else {
    console.log("Page not analysed because aiFiltering = false");
  }
  const userBlocklist: string[] = result.userBlocklist ?? [];
  console.log("userBlocklist", userBlocklist);
  for (const key in result.userBlocklist) {
    if (tabUrl.includes(result.userBlocklist[key])) PUNISH();
  }
});

interface ImagePixel {
  element: HTMLImageElement;
  pixels: number;
}

const analysePage = async () => {
  console.log(`Starting to analyse page...`);
  const imagePixelArray: ImagePixel[] = [];
  var imgs = document.getElementsByTagName("img");
  //@ts-expect-error I promise I will learn ts later
  imgs = [...imgs];
  console.log(`Found ${imgs.length} images on page`);

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    console.log('Image ' + i + ' :')
    console.log(img)
    img.width = img.clientWidth;
    img.height = img.clientHeight;
    //console.log('i', i, 'width', imgs[i].width, 'height', imgs[i].height, img)
    //console.log('last 3 chars of src : ', img.src.slice(-3))

    //----------------------------------THE GREAT FILTERS--------------------------------------//

    if (img.src
      && img.width > 41
      && img.height > 41
      && img.naturalHeight > 10
      && img.naturalWidth > 10
      && img.src.slice(-3) !== "svg"
      && img.src.slice(-3) !== "png"
      && img.src.slice(11, 14) !== "svg"
      ) {
      const pixels = img.width * img.height;
      imagePixelArray.push({ element: img, pixels });
    }

  }
  imagePixelArray.sort((a, b) => {
    if (a.pixels === b.pixels) return 0;
    return a.pixels > b.pixels ? -1 : 1;
  });
  //imagePixelArray.forEach(e => console.log(e))
  let imageArray = imagePixelArray.map((e) => e.element);

  let fetchableImages: HTMLImageElement[] = [];

  for (let i = 0; i < imageArray.length; i++) {
    const img = imageArray[i];
    try {
      await fetch(img.src);
      fetchableImages.push(img);
      console.log("image poussée");
      if (fetchableImages.length === NUMBER_OF_IMAGES_TO_ANALYZE) break;
    } catch (e: any) {
      console.log("erreur cors");
      continue;
    }
  }
  if (fetchableImages.length === 0) {
    console.log('No image worth analysing.')
    return
  }
  console.log(NUMBER_OF_IMAGES_TO_ANALYZE + " biggest fetchables images:", fetchableImages);

  const averageWH = (fetchableImages.map(e => e.width).reduce((a, b) => a + b, 0) + fetchableImages.map(e => e.height).reduce((a, b) => a + b, 0))/(2*fetchableImages.length)
  console.log('averageWH : ', averageWH)
  const promiseArray = fetchableImages.map((img) => {
    return new Promise((resolve, reject) => {
      const image: HTMLImageElement = new Image(img.width, img.height)
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(model.classify(image));
      image.src = img.src
    });
  });

  Promise.allSettled(promiseArray).then((predictions: PromiseSettledResult<unknown>[]) => {
    for (let i = 0; i < predictions.length; i++) {
      // @ts-expect-error promise I will learn ts
      const prediction: prediction = predictions[i]
      if (prediction.status === 'fulfilled') {
        console.log('Image ' + i + ' ' + prediction.status);
        for (const key in prediction.value) {
          console.log(prediction.value[key]);
        }
      }
      console.log('pScore : ' + getPScore(prediction))
      console.log('hScore : ' + getHScore(prediction))
      console.log(fetchableImages[i]);
    }
    // @ts-expect-error promise I will learn ts
    let pScores = predictions.map(e => getPScore(e)) // pScores = [0.675, 0.236, 0.456]
    // @ts-expect-error promise I will learn ts
    let hScores = predictions.map(e => getHScore(e))

    //Weight by image size :
    for (let i = 0; i < pScores.length; i++) {
      pScores[i] = pScores[i]*(fetchableImages[i].width + fetchableImages[i].height)/(2*averageWH)
    }
    for (let i = 0; i < hScores.length; i++) {
      hScores[i] = hScores[i]*(fetchableImages[i].width + fetchableImages[i].height)/(2*averageWH)
    }
    
    let pScore = pScores.reduce((a, b) => a + b, 0)/pScores.length
    let hScore = hScores.reduce((a, b) => a + b, 0)/hScores.length
    hScore += pScore*WEIGHT_OF_PSCORE_IN_HSCORE
    console.log(`-------------------------------------------------------`);
    console.log(`pScore Total : ${pScore}`);
    console.log(`hScore Total : ${hScore}`);
    if (pScore > PORN_THRESHOLD) {
      console.log("Seems like porn !");
      PUNISH();
    } else if (hScore > HENTAI_THRESHOLD){
      console.log("Seems like Hentai !");
      PUNISH();
    } else {
      console.log("All seems fine.");
    }
  })
};

interface values {
  status: string;
  value: {
    className: string;
    probability: number;
  }[];
}

function getPScore(value: values) {
  let pScore = 0;
  if (value.status == "fulfilled") {
    for (let i = 0; i < 5; i++) {
      if (value.value[i].className == "Porn") pScore += value.value[i].probability
      if (value.value[i].className == "Sexy") pScore += value.value[i].probability*SEXY_WEIGHT
    }
  }  
  return pScore
}

function getHScore(value: values) {
  let hScore = 0;
  if (value.status == "fulfilled") {
    for (let i = 0; i < 5; i++) {
      if (value.value[i].className == "Hentai") hScore += value.value[i].probability
    }
  }  
  return hScore
}

chrome.storage.sync.get(["dayCounter"], (result: any) => {
  if (result.dayCounter) {
    chrome.runtime.sendMessage({ greeting: "refreshDayCounter" });
  }
});


//MODULE WEBHOOK :
function PUNISH() {
  const url = tabUrl.replace("https://", "");
  //url = url.replace('/', '')
  chrome.storage.sync.get(["username"], function (data) {
    if (data.username) {
      chrome.runtime.sendMessage({ message: "SendItToDiscord!", username: data.username, url: url});
      //block();
    } else {
      console.log("Triché mais pas connecté !");
      //block();
    }
  });
}

function block() {
  chrome.storage.sync.get(["blockingType"], function (result) {
    if (result.blockingType === 0 || result.blockingType === 1) {
      location.replace(
        "chrome-extension://" +
          chrome.runtime.id +
          "/blockpages/blockpageChad.html"
      );
    } else if (result.blockingType === 2) {
      location.replace(
        "chrome-extension://" +
          chrome.runtime.id +
          "/blockpages/blockpageVideo.html"
      );
    } else if (result.blockingType === 3) {
      chrome.runtime.sendMessage({ message: "closeIt" });
    } else {
      console.log("This blocking type does not exist");
    }
  });
}
