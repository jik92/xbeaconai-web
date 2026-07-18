import { describe, expect, test } from "bun:test";
import { AiGenerateMockStore, validateGenerateReferences } from "../../src/features/ai-generate/ai-generate-mock";

describe("AI generate browser Mock",()=>{
  test("matches the reference defaults",()=>{
    const store=new AiGenerateMockStore(),state=store.getSnapshot();
    expect(state).toMatchObject({kind:"video",model:"seedance-2.0",referenceMode:"omni",ratio:"9:16",resolution:"720P",duration:5,count:1,manualConfirm:false});
    store.dispose();
  });

  test("enforces one reference of each media kind in video mode",()=>{
    const image=new File(["image"],"one.png",{type:"image/png"}),secondImage=new File(["image"],"two.png",{type:"image/png"});
    expect(validateGenerateReferences([], [image], "video")).toBeUndefined();
    expect(validateGenerateReferences([{id:"1",name:"one.png",kind:"image",mimeType:"image/png",size:5,url:"blob:test"}],[secondImage],"video")).toContain("每类最多");
  });

  test("completes a deterministic local task and supports result actions",async()=>{
    const store=new AiGenerateMockStore();store.setPrompt("一只猫在雨夜穿过霓虹街道");expect(store.submit()).toBeTrue();expect(store.active().results[0].status).toBe("generating");await Bun.sleep(1000);const completed=store.active().results[0];expect(completed.status).toBe("completed");store.toggleFavorite(completed.id);expect(store.active().results[0].favorite).toBeTrue();store.createVariant(completed.id);expect(store.active().results).toHaveLength(2);store.continueFrom(completed.id);expect(store.getSnapshot().prompt).toStartWith("继续优化");store.dispose();
  });

  test("contains no business API dependency",async()=>{
    const source=await Bun.file("src/features/ai-generate/ai-generate-page.tsx").text();
    expect(source).not.toContain("@/api/");expect(source).not.toContain("fetch(");expect(source).not.toContain("submitJob");
  });
});
